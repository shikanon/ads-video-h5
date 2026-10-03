import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile,writeFile,mkdir,mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inferCreationRoute,planCreationRoute,resolveCreativeRequest,requestedModelNames } from '../server/creativeRequest';
import { checkRequestContract,requestEvaluationContext,type RequestEvaluationCase } from '../server/requestEvaluations';
import { createToolTrace,executionDiagnostics,traceValue } from '../server/toolTrace';
import { runLessonWorkflow } from '../server/lessonWorkflow';
import { sessionSources } from '../server/sourceSelection';
import { ARK_BASE_URL,TEXT_MODEL_PRESETS } from '../shared/textModels';
import type { LessonChapter,MediaItem,WorkflowEvent } from '../src/types';

const config=(i=0)=>({...TEXT_MODEL_PRESETS[i],kind:'text' as const,provider:'ark',baseUrl:ARK_BASE_URL,enabled:true,apiKey:'test-private-credential'});
let call=0;
function reply(name:string,args:unknown,model=config().modelId) {
  const chunks=[{delta:{role:'assistant'},finish_reason:null},{delta:{tool_calls:[{index:0,id:'call-'+(++call),type:'function',function:{name,arguments:JSON.stringify(args)}}]},finish_reason:null},{delta:{},finish_reason:'tool_calls'}];
  return new Response(chunks.map(c=>`data: ${JSON.stringify({id:'test',object:'chat.completion.chunk',created:1,model,choices:[{index:0,...c}]})}\n\n`).join('')+'data: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});
}
const {cases}=JSON.parse(await readFile(new URL('./fixtures/agent-requests.json',import.meta.url),'utf8')) as {cases:RequestEvaluationCase[]};

for(const c of cases)test(`request contract: ${c.id}`,async()=>{
  const original=globalThis.fetch,events:WorkflowEvent[]=[];
  globalThis.fetch=async(_url,init)=>{
    const body=JSON.parse(String(init?.body));assert.equal(body.tool_choice,'required');
    assert.ok(JSON.stringify(body.messages).includes('sourceCount'));
    return reply('route_video_request',{mode:c.expected.mode,topic:c.expected.topic||'用户指定主题',export:c.expected.export,reason:'受控模型响应，用于校验生产路由契约'});
  };
  try {
    const route=await planCreationRoute(requestEvaluationContext(c),async()=>config(),async es=>{
      for(const e of es){const i=events.findIndex(v=>v.callId===e.callId);if(i<0)events.push(structuredClone(e));else events[i]=structuredClone(e);}
    });
    const result=checkRequestContract(c,route,events);
    assert.equal(result.passed,true,JSON.stringify(result.checks.filter(c=>!c.passed)));
    assert.ok(events.some(e=>e.tool==='plan_creation_route'&&e.status==='succeeded'));
    assert.doesNotMatch(JSON.stringify(events),/test-private-credential/);
  }finally{globalThis.fetch=original;}
});

test('shared media availability cannot turn a fresh topic request into recorded-footage editing',async()=>{
  const c=cases[0],media=[{id:'old',kind:'video',duration:30,name:'old.mp4',mimeType:'video/mp4',url:'',createdAt:''}] as MediaItem[];
  const selected=sessionSources(c.prompt,media,[],null,[]);assert.equal(selected.length,0);
  const route=inferCreationRoute({...requestEvaluationContext(c),sourceCount:selected.length})!;
  assert.equal(route.mode,'news');assert.equal(route.export,true);assert.equal(route.requiresFootage,false);
});

test('bare exports ask for a topic while a concrete polite production question still proceeds',()=>{
  for(const prompt of ['生成成片','请直接生成成片','制作视频','你能制作科普视频吗？']){
    const route=inferCreationRoute({prompt,history:[],sourceCount:0,hasPlan:false})!;
    assert.equal(route.mode,'conversation',prompt);assert.equal(route.export,false,prompt);assert.equal(route.requiresFootage,false,prompt);
  }
  assert.equal(inferCreationRoute(requestEvaluationContext(cases.find(c=>c.id==='lesson-question')!))!.mode,'explainer');
});

test('semantic routing rejects changed model versions and retries using the actual tool feedback',async()=>{
  const original=globalThis.fetch,events:WorkflowEvent[]=[];let attempts=0;
  globalThis.fetch=async(_url,init)=>{
    const body=JSON.parse(String(init?.body));attempts++;
    if(attempts===2)assert.ok(JSON.stringify(body.messages).includes('主题必须保留用户原始名称与版本'));
    return reply('route_video_request',{mode:'news',topic:attempts===1?'Fable5.1':'Fable5.5',export:true,reason:'按原名称查证'});
  };
  try{
    const result=await resolveCreativeRequest(config(),'制作讲Fable5.5的短片，展示最近的消息',[],0,async e=>{events.splice(0,events.length,...structuredClone(e));});
    assert.equal(result.topic,'Fable5.5');assert.equal(attempts,2);
    const diagnostic=executionDiagnostics(events);assert.equal(diagnostic.failures[0].kind,'validation');assert.equal(diagnostic.recoveredFailures,1);
  }finally{globalThis.fetch=original;}
});

test('technical durations and rendering settings are not mistaken for versioned subjects',async()=>{
  assert.deepEqual(requestedModelNames('Make a news video about Fable 5.5, pause 0.5 seconds, transition 0.25 seconds, zoom1.2.'),['Fable 5.5']);
  assert.deepEqual(requestedModelNames('主题：Pause0.5，生成新闻视频'),['Pause0.5'],'an explicitly named subject is still pinned');
  const original=globalThis.fetch;
  globalThis.fetch=async()=>reply('route_video_request',{mode:'news',topic:'近期气候新闻',export:true,reason:'用户指定气候新闻，停顿是制作设置'});
  try {const result=await resolveCreativeRequest(config(),'做一期近期气候新闻视频，90 seconds，portrait，pause 0.5 seconds between scenes。',[],0,async()=>{});assert.equal(result.topic,'近期气候新闻');}
  finally{globalThis.fetch=original;}
});

test('invalid route decisions stop after the bounded attempts and never silently choose another topic',async()=>{
  const original=globalThis.fetch;let attempts=0;
  globalThis.fetch=async()=>{attempts++;return reply('route_video_request',{mode:'news',topic:'Fable5.1',export:true,reason:'错误版本'});};
  try{await assert.rejects(()=>resolveCreativeRequest(config(),'制作Fable5.5新闻视频',[],0,async()=>{}),/规划未完成/);assert.equal(attempts,3);}
  finally{globalThis.fetch=original;}
});

for(let index=0;index<3;index++)test(`${TEXT_MODEL_PRESETS[index].modelId}: missing footage does not revoke an explicit production request`,async()=>{
  const original=globalThis.fetch,events:WorkflowEvent[]=[];let attempts=0;
  globalThis.fetch=async(_url,init)=>{
    const body=JSON.parse(String(init?.body));attempts++;
    assert.equal(body.thinking.type,index===2?'enabled':'disabled');
    if(attempts===2)assert.match(JSON.stringify(body.messages),/必须选择footage/);
    return reply('route_video_request',{mode:attempts===1?'conversation':'footage',topic:'原片新闻',export:attempts===2,reason:'原片需要选定，但用户已经授权制作'},config(index).modelId);
  };
  try{
    const result=await resolveCreativeRequest(config(index),'用上传的真人视频剪一段新闻快讯，不要生成新画面',[],0,async e=>{events.splice(0,events.length,...structuredClone(e));});
    assert.equal(result.mode,'footage');assert.equal(result.export,true);assert.equal(attempts,2);assert.equal(executionDiagnostics(events).recoveredFailures,1);
  }finally{globalThis.fetch=original;}
});

test('diagnostics record observed recovery but do not infer success from unrelated calls or store private reasoning',async()=>{
  const trace=createToolTrace(async()=>{},['private-key-value']);
  await assert.rejects(trace.run('render_lesson','渲染',{},async()=>{throw new Error('HTTP 503 private-key-value');}));
  await trace.run('research_topic','查证',{},async()=>({reason:'公开决策依据',reasoning_content:'PRIVATE-REASONING',thinking:'PRIVATE-THINKING'}));
  assert.equal(executionDiagnostics(trace.events).recoveredFailures,0);
  await trace.run('render_lesson','重试渲染',{},async()=>({artifactId:'new-file'}));
  assert.equal(executionDiagnostics(trace.events).recoveredFailures,1);
  assert.doesNotMatch(JSON.stringify(trace.events),/PRIVATE-REASONING|PRIVATE-THINKING|private-key-value/);
  assert.equal((traceValue({reason:'brief reason'}) as any).reason,'brief reason');
});

for(let index=0;index<3;index++)test(`${TEXT_MODEL_PRESETS[index].modelId}: real planning loop recovers invalid script, HTTP failure and factual rejection without rendering`,async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'qingjian-request-recovery-')),checkpoint='case',owner='fixture-owner',prompt='制作45秒横屏知识图解视频，解释预测误差如何评分，先给脚本';
  const work=path.join(directory,'lesson-workflows',checkpoint);await mkdir(work,{recursive:true});
  const references=[1,2,3].map(i=>({id:'r'+i,title:'Controlled primary source '+i,url:'https://arxiv.org/abs/1708.0200'+i,verification:'primary-page',excerpt:'Controlled source fixture: error magnitude and a score, not live research.'}));
  const fingerprint=createHash('sha256').update(JSON.stringify({version:1,owner,prompt,export:false})).digest('hex');
  await writeFile(path.join(work,'checkpoint.json'),JSON.stringify({fingerprint,phase:'script',research:{summary:'受控研究夹具，非真实联网验收',queries:[],references},researchRounds:2}));
  const chapters:LessonChapter[]=Array.from({length:3},(_,i)=>({id:'c'+i,role:i===0?'hook':i===1?'foundation':'recap',title:'误差评分'+i,goal:'理解误差与评分',prerequisites:i?['c'+(i-1)]:[],narration:'误差变大损失越高。'.repeat(7),reason:'先例子再归纳',referenceIds:['r1'],claims:[{text:'误差影响评分',referenceIds:['r1']}],visual:{kind:'concept',takeaway:'误差影响评分',items:[{label:'误差',detail:'预测与实际的差',cue:'误差变大'},{label:'评分',detail:'为偏差计分',cue:'损失越高'}]}}));
  const original=globalThis.fetch;let writes=0,reviews=0;const requests:string[]=[],events:WorkflowEvent[]=[];
  globalThis.fetch=async(_url,init)=>{
    const body=JSON.parse(String(init?.body));assert.equal(body.thinking.type,index===2?'enabled':'disabled');
    if(!body.stream){reviews++;if(reviews===1)return new Response('{}',{status:503});return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(reviews===2?{score:75,needsRepair:true,findings:['c1：示例表述有实际错误，请修正旁白。']}:{score:92,needsRepair:false,findings:[]})}}]}));}
    const name=body.tool_choice.function.name;requests.push(name);assert.deepEqual(body.tools.map((t:any)=>t.function.name),[name]);
    if(name==='write_lesson_script'){writes++;if(writes===2)assert.ok(JSON.stringify(body.messages).includes('教学需要3–24个不同章节'));
      return reply(name,{title:'误差评分',audience:'初学者',objectives:['理解误差','理解评分'],arc:'先误差再评分',chapters:writes===1?chapters.slice(0,2):chapters},config(index).modelId);
    }
    if(name==='revise_lesson_script'){
      assert.ok(JSON.stringify(body.messages).includes('c1：示例表述有实际错误'));
      return reply(name,{chapters:[{...chapters[1],narration:'误差变大损失越高。'.repeat(6)+'这是修正后的完整示例。'}]},config(index).modelId);
    }
    assert.equal(name,'review_lesson_script');return reply(name,{},config(index).modelId);
  };
  try{
    const result=await runLessonWorkflow({prompt,config:config(index),audioConfig:null,dataDir:directory,mediaDir:directory,ownerId:owner,checkpointKey:checkpoint,media:[],export:false,analyze:async()=>{throw new Error('script-only must not analyze audio');},register:async()=>{throw new Error('script-only must not create media');},persist:async()=>{throw new Error('script-only must not create a timeline');},saveDraft:async()=>{},progress:async e=>{events.splice(0,events.length,...structuredClone(e));},render:async()=>{throw new Error('script-only must not render');},review:async()=>{throw new Error('script-only must not review a movie');}});
    assert.equal(result.report.factReview?.score,92);assert.equal(result.report.factReview?.needsRepair,false);
    assert.deepEqual(requests,['write_lesson_script','write_lesson_script','review_lesson_script','review_lesson_script','revise_lesson_script','review_lesson_script']);
    assert.equal(reviews,3);assert.deepEqual(result.report.chapters[0],chapters[0]);assert.deepEqual(result.report.chapters[2],chapters[2]);
    assert.notEqual(result.report.chapters[1].narration,chapters[1].narration);
    assert.equal(executionDiagnostics(events).recoveredFailures,2);
    assert.equal(executionDiagnostics(events).qualityFeedback[0].status,'repaired');
    assert.equal(executionDiagnostics(events).qualityFeedback[0].repairTool,'revise_lesson_script');
    assert.doesNotMatch(JSON.stringify(events),/test-private-credential/);
    assert.equal(result.rendered,undefined);assert.equal(result.plan,undefined);
  }finally{globalThis.fetch=original;await rm(directory,{recursive:true,force:true});}
});
