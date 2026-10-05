import { readFile,writeFile,mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { getModelConfig } from '../server/modelRegistry';
import { runLessonWorkflow } from '../server/lessonWorkflow';
import { JobCancelledError,runWithJobSignal } from '../server/jobExecution';
import { traceValue } from '../server/toolTrace';
import { TEXT_MODEL_PRESETS } from '../shared/textModels';
import type { WorkflowEvent } from '../src/types';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2),value=(flag:string)=>args.includes(flag)?args[args.indexOf(flag)+1]:undefined;
if(args.includes('--help')||!args.includes('--live')){
  console.log('pnpm eval:workflow-entry --live [--models all|registry-id] [--case case-id] [--through entry|research] [--out file.json]\nEntry stops at research_topic dispatch (the server starts news research without a model decision). Research runs actual search, webpage verification and topic validation, then cancels before scripts or media. Neither mode is movie acceptance.');process.exit(args.includes('--help')?0:1);
}
const through=value('--through')||'entry';if(!['entry','research'].includes(through))throw new Error('--through must be entry or research');
const fixture=JSON.parse(await readFile(path.join(root,'tests/fixtures/workflow-entry.json'),'utf8')) as {version:number;cases:{id:string;prompt:string}[]};
const cases=fixture.cases.filter(c=>!value('--case')||c.id===value('--case'));
if(!cases.length)throw new Error('No matching workflow-entry cases');
const selected=value('--models')==='all'?TEXT_MODEL_PRESETS.map(p=>p.id):[value('--models')||'ark-text'];
const at=new Date().toISOString(),out=path.resolve(value('--out')||path.join(root,'data/workflow-entry-evaluations',at.replace(/[:.]/g,'-')+'.json'));
const directory=out.replace(/\.json$/,'')+'-runs';await mkdir(directory,{recursive:true});
const implementation=createHash('sha256');
for(const file of ['server/lessonWorkflow.ts','server/hotResearch.ts','server/narrativeResearch.ts','server/core.ts','skills/qingjian-hot-video/SKILL.md'])implementation.update(await readFile(path.join(root,file)));
const report:any={createdAt:at,revision:execFileSync('git',['rev-parse','HEAD'],{cwd:root}).toString().trim(),workingTreeDirty:Boolean(execFileSync('git',['status','--porcelain'],{cwd:root}).toString().trim()),implementationHash:implementation.digest('hex'),fixtureVersion:fixture.version,through,scope:through==='research'?'Actual production news research: search, source-page reading, dates and cross-source evidence. Cancels after research completes, before scripts or media; not movie acceptance.':'Production research dispatch only. News is started by the server before a model decision; teaching uses the Agent. Cancels before executing research; not movie acceptance or a model capability score.',models:[]};
const audioConfig=await getModelConfig('audio');
for(const id of selected){
  const config=await getModelConfig('text',id);if(!config)throw new Error(`Text model ${id} is unavailable`);
  const model:any={id,modelId:config.modelId,results:[]};report.models.push(model);
  for(const c of cases){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),through==='research'?300000:60000),started=Date.now();let dispatch:WorkflowEvent|undefined,completed=false;const events:WorkflowEvent[]=[],seen=new Map<string,string>();
    const checkpointKey=id+'-'+c.id;
    const row:any={...c,passed:false};
    try{
      await runWithJobSignal(controller.signal,()=>runLessonWorkflow({prompt:c.prompt,config,audioConfig,media:[],dataDir:directory,mediaDir:directory,ownerId:'workflow-entry-evaluation',checkpointKey,export:true,
        analyze:async()=>{throw new Error('Entry evaluation must not analyze audio');},register:async()=>{throw new Error('Entry evaluation must not register media');},persist:async()=>{},saveDraft:async()=>{},
        progress:async updates=>{
          events.splice(0,events.length,...structuredClone(updates));
          for(const e of updates){if(e.callId&&seen.get(e.callId)!==e.status){seen.set(e.callId,e.status);console.log(JSON.stringify({model:id,case:c.id,tool:e.tool,status:e.status}));}}
          const event=updates.find(e=>e.tool==='research_topic');
          if(event)dispatch=structuredClone(event);
          if(event&&(through==='entry'||event.status==='succeeded')){completed=event.status==='succeeded';controller.abort();throw new JobCancelledError();}
        },
        render:async()=>{throw new Error('Entry evaluation must not render');},review:async()=>{throw new Error('Entry evaluation must not review a movie');}}));
    }catch(error){
      row.passed=through==='entry'?Boolean(dispatch):completed;
      if(dispatch)row.dispatch={tool:dispatch.tool,by:dispatch.callId?.startsWith('server-')?'server':'model',status:dispatch.status,input:dispatch.input};
      if(!row.passed)row.error=traceValue(error instanceof Error?error.message:String(error),[config.apiKey,audioConfig?.apiKey||'']);
    }finally{clearTimeout(timer);}
    try{row.responses=(await readFile(path.join(directory,'lesson-workflows',checkpointKey,'llm-response-meta.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(s=>JSON.parse(s));}catch{}
    row.workflow=events;
    if(completed){const research=JSON.parse(await readFile(path.join(directory,'lesson-workflows',checkpointKey,'research.json'),'utf8'));row.research={topics:research.current?.topics,references:research.references.map((r:any)=>({id:r.id,title:r.title,url:r.url,publishedAt:r.publishedAt,freshness:r.freshness,verification:r.verification})),failures:research.current?.failures};}
    row.elapsedMs=Date.now()-started;model.results.push(row);
    console.log(JSON.stringify({model:id,case:c.id,passed:row.passed,responseTurns:row.responses?.length,error:row.error,elapsedMs:row.elapsedMs}));
    await writeFile(out,JSON.stringify(report,null,2)+'\n',{mode:0o600});
  }
  model.summary={total:cases.length,passed:model.results.filter((r:any)=>r.passed).length,failed:model.results.filter((r:any)=>!r.passed).length};
}
await writeFile(out,JSON.stringify(report,null,2)+'\n',{mode:0o600});
if(report.models.some((m:any)=>m.summary.failed))process.exitCode=1;
