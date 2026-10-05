import { readFile,writeFile,mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { getModelConfig } from '../server/modelRegistry';
import { runEditorialWorkflow } from '../server/editorialWorkflow';
import { runWithJobSignal } from '../server/jobExecution';
import { executionDiagnostics,traceValue } from '../server/toolTrace';
import { TEXT_MODEL_PRESETS } from '../shared/textModels';
import type { MediaItem,RenderReview,WorkflowEvent } from '../src/types';

const args=process.argv.slice(2),value=(flag:string)=>args.includes(flag)?args[args.indexOf(flag)+1]:undefined;
if(!args.includes('--live')||args.includes('--help')){console.log('pnpm eval:recovery --live [--models all|registry-id] [--fault empty-tool-turns|rejected-review|all] --out report.json\nReal model decisions in the production editorial workflow, with declared fault injection and controlled source/render/review fixtures. Measures recovery and source preservation, never actual video quality.');process.exit(args.includes('--help')?0:1);}
const faults=value('--fault')&&value('--fault')!=='all'?[value('--fault')!]:['empty-tool-turns','rejected-review'];
if(faults.some(f=>!['empty-tool-turns','rejected-review'].includes(f)))throw new Error('Invalid fault');
const ids=value('--models')==='all'?TEXT_MODEL_PRESETS.map(m=>m.id):[value('--models')||'ark-text'];
const out=path.resolve(value('--out')||path.join('data/recovery-evaluations',Date.now()+'.json'));
await mkdir(path.dirname(out),{recursive:true});
const implementation=createHash('sha256');for(const file of ['server/workflowDriver.ts','server/editorialWorkflow.ts','server/core.ts','server/requiredTool.ts'])implementation.update(await readFile(file));
const report:any={createdAt:new Date().toISOString(),scope:'Real provider decisions with controlled fault injection. Source transcript, scene inspection, render and review are fixtures. No actual media quality, deployed-server or Browser grade.',revision:execFileSync('git',['rev-parse','HEAD']).toString().trim(),implementationHash:implementation.digest('hex'),models:[]};
const realFetch=globalThis.fetch;
for(const id of ids){
  const config=await getModelConfig('text',id);if(!config)throw new Error('Model unavailable: '+id);
  const model:any={id,modelId:config.modelId,results:[]};report.models.push(model);
  for(const fault of faults){
    const events:WorkflowEvent[]=[];let providerCalls=0,injectedTurns=0,renders=0,reviews=0,transcriptions=0;const start=Date.now(),controller=new AbortController();
    const source:MediaItem={id:'source',name:'controlled-original.mp4',kind:'video',mimeType:'video/mp4',duration:12,url:'',createdAt:''};
    const prompt='将已选素材精剪为10秒竖屏成片，保留全部三句完整原话，按目标、行动、检查的顺序，加字幕和圈选动效，不要生成新配音。';
    globalThis.fetch=async(input,init)=>{
      const body=JSON.parse(String(init?.body||'{}'));
      if(fault==='empty-tool-turns'&&body.stream&&injectedTurns<2){injectedTurns++;
        return new Response(`data: ${JSON.stringify({id:'injected',object:'chat.completion.chunk',created:1,model:config.modelId,choices:[{index:0,delta:{role:'assistant',content:injectedTurns===1?'本轮没有渲染工具，请提供素材。':''},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`,{headers:{'Content-Type':'text/event-stream'}});
      }
      providerCalls++;return realFetch(input,init);
    };
    const row:any={fault,prompt,passed:false};model.results.push(row);const timer=setTimeout(()=>controller.abort(),180000);
    try{
      const result=await runWithJobSignal(controller.signal,()=>runEditorialWorkflow({prompt,config,sources:[source],previous:null,export:true,
        transcribe:async()=>{transcriptions++;return {status:'ready',modelId:'controlled-fixture',sourceHash:'controlled-source-hash',duration:12,transcript:'先明确目标，再采取行动，最后检查结果。',sentences:[{id:'s1',start:0,end:3,text:'先明确目标，',complete:true,words:[{text:'先明确目标，',start:0,end:3}]},{id:'s2',start:3,end:6,text:'再采取行动，',complete:true,words:[{text:'再采取行动，',start:3,end:6}]},{id:'s3',start:6,end:10,text:'最后检查结果。',complete:true,words:[{text:'最后检查结果。',start:6,end:10}]}],pauses:[],warnings:[],timing:'model-estimated',createdAt:''};},
        inspect:async()=>({safeZone:'top',summary:'控制夹具的上方空白区'} as any),persist:async()=>{},
        render:async()=>({id:'controlled-movie-'+(++renders),file:'controlled-not-a-real-movie.mp4'}),
        review:async()=>{reviews++;const reject=fault==='rejected-review'&&reviews===1;return {status:reject?'needs-review':'passed',score:reject?78:88,checks:[{name:'控制用审查',passed:!reject,detail:reject?'scene-1：circle遮挡内容，修改为underline并保留所有原话。':'控制夹具通过，仅用于验证状态推进'}],semantic:{score:reject?78:88,findings:reject?['scene-1：circle遮挡内容，修改为underline并保留所有原话。']:[],suggestions:[]},limitations:['控制用审查，不是实际视频评分'],createdAt:''} satisfies RenderReview;},
        progress:async updates=>{events.splice(0,events.length,...structuredClone(updates));},
      }));
      const ids=result.plan.editorial!.scenes.flatMap(s=>s.sentenceIds),graphics=result.plan.editorial!.script.beats.map(b=>b.graphic);
      row.checks={completed:result.review?.status==='passed',preservedSources:ids.length===3&&['s1','s2','s3'].every(id=>ids.includes(id)),transcribedOnce:transcriptions===1,recovered:fault==='empty-tool-turns'?events.some(e=>e.tool==='recover_tool_call'&&e.status==='succeeded'):renders===2&&reviews===2&&graphics.includes('underline')};
      row.passed=Object.values(row.checks).every(Boolean);
    }catch(error){row.error=traceValue(error instanceof Error?error.message:String(error),[config.apiKey]);}
    finally{clearTimeout(timer);globalThis.fetch=realFetch;}
    Object.assign(row,{elapsedMs:Date.now()-start,providerCalls,injectedTurns,renders,reviews,workflow:events,diagnostics:executionDiagnostics(events)});
    console.log(JSON.stringify({model:id,fault,passed:row.passed,checks:row.checks,error:row.error,elapsedMs:row.elapsedMs,providerCalls}));
    await writeFile(out,JSON.stringify(report,null,2)+'\n',{mode:0o600});
  }
  model.summary={total:model.results.length,passed:model.results.filter((r:any)=>r.passed).length};
  await writeFile(out,JSON.stringify(report,null,2)+'\n',{mode:0o600});
}
if(report.models.some((m:any)=>m.summary.passed<m.summary.total))process.exitCode=1;
