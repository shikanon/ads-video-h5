import test from 'node:test';
import assert from 'node:assert/strict';
import { hydrateRebuiltBeats, voiceReferenceAuthorized, validateEnterpriseNarrative } from '../server/narrativeWorkflow';
import { drawingHtml, validateDrawing } from '../server/narrativeScenes';
import { classify } from '../server/intents';
import { validatePlan } from '../server/core';
import { getAgent } from '../server/core';
import { mergeResearch } from '../server/narrativeResearch';
import type { MediaItem, ReconstructionBeat, ReconstructionReport, EditPlan } from '../src/types';

const source:MediaItem={id:'raw',name:'raw.mp4',kind:'video',mimeType:'video/mp4',duration:8,url:'',createdAt:'',analysis:{status:'ready',modelId:'test',sourceHash:'raw-hash',duration:8,transcript:'先把需求说清楚',sentences:[{id:'s1',start:1,end:5,text:'先把需求说清楚',complete:true,words:[{start:1,end:5,text:'先把需求说清楚'}]}],pauses:[],timing:'model-estimated',warnings:[],createdAt:''}};
const original:ReconstructionBeat={id:'original',role:'需求',line:'先把需求说清楚',reason:'用真实原话说明先明确需求',mode:'original',sourceId:'raw',sentenceIds:['s1'],referenceIds:[],visual:'person',title:'明确需求',visualBrief:'真人原声推近'};
const generated:ReconstructionBeat={id:'generated',role:'补充',line:'定义验收标准',reason:'补上原片缺失的操作步骤',mode:'generated',referenceIds:['ref-1'],visual:'html',title:'验收标准',visualBrief:'画输出与验收之间的流程'};
test('one brief reconstruction prompt routes to a complete export, preserving plan-only requests',()=>{
  assert.equal(classify('重构36秒知识短片，联网补充，用我的声音，直接出片。'),'export');
  assert.equal(classify('重构知识短片，先给脚本，不要导出'),'plan');
});
test('rebuilt narrative cannot rewrite a recorded line or invent a research citation',()=>{
  const beats=hydrateRebuiltBeats([original,generated],[source],['ref-1']);assert.equal(beats[0].evidence?.sourceHash,'raw-hash');assert.equal(beats[1].evidence,undefined);
  assert.throws(()=>hydrateRebuiltBeats([{...original,line:'需求不重要'}],[source],['ref-1']),/完整原话/);
  assert.throws(()=>hydrateRebuiltBeats([{...generated,referenceIds:['invented']}],[source],['ref-1']),/referenceIds/);
  assert.throws(()=>hydrateRebuiltBeats([{...generated,visual:'person'}],[source],['ref-1']),/HTML/);
});
test('mixed timeline rejects truncated testimony and fabricated generated assets',()=>{
  const beats=hydrateRebuiltBeats([original],[source],[]).map(b=>({...b,mediaId:'raw',duration:4}));
  const report:ReconstructionReport={workflowId:'run',premise:'明确需求',audience:'团队',arc:'先需求再验收',style:'暖白',gaps:[],references:[],beats,requestedSeconds:10,limitations:[]};
  const plan:EditPlan={format:'9:16',targetSeconds:4,summary:'明确需求',clips:[{sceneId:'original',sourceId:'raw',start:1,end:5,sentenceIds:['s1']}],reconstruction:report};
  assert.doesNotThrow(()=>validatePlan(plan,[source]));
  assert.throws(()=>validatePlan({...plan,clips:[{...plan.clips[0],end:4}]},[source]),/截断/);
  assert.throws(()=>validatePlan({...plan,reconstruction:{...report,beats:beats.map(b=>({...b,evidence:{...b.evidence!,quote:'伪造'}}))}},[source]),/证据/);
});
test('HTML drawing treats model text as data and enforces diagram safe area',()=>{
  const nodes=Array.from({length:3},(_,i)=>({id:`node-${i}`,kind:'card' as const,x:60,y:240+i*180,w:600,h:140,text:i?'需求':'<script>alert(1)</script>',tone:'paper' as const,fontSize:40,highlight:true}));
  const html=drawingHtml({title:'信息图',nodes},4);assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>alert(1)'));
  assert.throws(()=>validateDrawing({title:'越界',nodes:nodes.map(n=>({...n,y:1100}))}),/安全区/);
});
test('diagram connectors accept vertical and leftward paths without applying text font rules',()=>{
  const nodes=[{id:'vertical',kind:'line' as const,x:360,y:300,w:0,h:120,text:'',tone:'ink' as const,fontSize:0,highlight:false},{id:'left',kind:'line' as const,x:360,y:420,w:-120,h:100,text:'',tone:'ink' as const,fontSize:0,highlight:false},{id:'text',kind:'text' as const,x:100,y:550,w:400,h:100,text:'需求',tone:'ink' as const,fontSize:40,highlight:false}];
  assert.doesNotThrow(()=>validateDrawing({title:'连线',nodes}));
  assert.throws(()=>validateDrawing({title:'越界',nodes:nodes.map(n=>n.id==='left'?{...n,w:-400}:n)}),/安全区/);
});
test('voice permission follows the latest user instruction including explicit revocation',()=>{
  const history=[{role:'user',text:'用我的声音，直接出片'}];
  assert.equal(voiceReferenceAuthorized(history),true);
  assert.equal(voiceReferenceAuthorized([...history,{role:'user',text:'不要用我的声音'}]),false);
  assert.equal(voiceReferenceAuthorized([{role:'assistant',text:'用户授权我的声音'}]),false);
});
test('seven roles must deliver their actual point instead of substituting a macro statistic for a scenario',()=>{
  const roles=['hook','requirements','scenario','rework','sop','prompt-knowledge','result'];
  const lines=['AI为何难落地？','先确定需求','选具体产品与使用触点','需求含糊导致反复返工','流程遵循SOP','Prompt约束输出，知识库提供检索资料','流程带来可复用成果'];
  const beats=roles.map((role,i)=>({...generated,id:`beat-${i}`,role,line:lines[i]}));
  assert.doesNotThrow(()=>validateEnterpriseNarrative(beats));
  assert.throws(()=>validateEnterpriseNarrative(beats.map((b,i)=>i===2?{...b,line:'调查称七成卡点在人和流程'}:b)),/具体产品/);
});
test('additional research preserves existing citation IDs rather than changing their source',()=>{
  const ref=(id:string,url:string)=>({id,url,title:url,excerpt:'summary',retrievedAt:'now',verification:'search-cited' as const});
  const first={summary:'RAG',references:[ref('ref-1','https://learn.microsoft.com/rag')],queries:[],usage:{}};
  const more={summary:'scene',references:[ref('ref-1','https://amazon.com/scene'),ref('ref-2','https://learn.microsoft.com/rag')],queries:[],usage:{}};
  const merged=mergeResearch(first,more);assert.equal(merged.references[0].url,first.references[0].url);assert.equal(merged.references[1].id,'ref-2');assert.equal(merged.references.length,2);assert.ok(merged.summary.includes('RAG'));
});
test('Seed 2.1 planning uses verified maximum output and full context rather than a 4K default',()=>{
  const config={id:'test',name:'test',kind:'text' as const,provider:'ark',modelId:'doubao-seed-2-1-pro-260915',apiKey:'dummy',baseUrl:'https://ark.cn-beijing.volces.com/api/v3',enabled:true};
  const agent=getAgent(config,[],'test');assert.equal(agent.state.model.maxTokens,262144);assert.equal(agent.state.model.contextWindow,1024000);assert.equal(agent.state.model.compat?.maxTokensField,'max_tokens');
});
test('SVG product paths are drawn safely and the indication label stays out of subtitle space',()=>{
  const nodes=[{id:'cup_body',kind:'path' as const,pathData:'M260 300 L460 300 L450 620 L270 620 Z',x:260,y:300,w:200,h:320,text:'',tone:'blue' as const,fontSize:24,highlight:true},{id:'left',kind:'text' as const,x:50,y:700,w:250,h:90,text:'商品主图',tone:'ink' as const,fontSize:36,highlight:false},{id:'right',kind:'text' as const,x:410,y:700,w:250,h:90,text:'详情稿',tone:'ink' as const,fontSize:36,highlight:false}];
  const html=drawingHtml({title:'AI成果示意',nodes},4);assert.ok(html.includes('id="cup_body"'));assert.ok(html.includes('top:180px'));assert.ok(!html.includes('foreignObject'));
  assert.throws(()=>validateDrawing({title:'攻击',nodes:nodes.map(n=>n.id==='cup_body'?{...n,pathData:'M260 300" onload="alert(1)'}:n)}),/pathData/);
});
