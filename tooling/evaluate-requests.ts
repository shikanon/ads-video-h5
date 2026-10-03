import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inferCreationRoute,planCreationRoute,resolveCreativeRequest } from '../server/creativeRequest';
import { getModelConfig } from '../server/modelRegistry';
import { checkRequestContract,requestCaseHash,requestEvaluationContext,type RequestEvaluationCase } from '../server/requestEvaluations';
import { traceValue } from '../server/toolTrace';
import { TEXT_MODEL_PRESETS } from '../shared/textModels';
import type { WorkflowEvent } from '../src/types';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2),value=(flag:string)=>args.includes(flag)?args[args.indexOf(flag)+1]:undefined;
const live=args.includes('--live'),probe=args.includes('--probe');
if(args.includes('--help')){
  console.log('pnpm eval:requests [--live] [--probe] [--models all|registry-id] [--family family] [--out file.json]\nDefault: offline production rules; unresolved requests are deferred, never counted as passing. --live uses configured models. --probe tests every semantic decision; it does not generate media.');process.exit(0);
}
if(probe&&!live)throw new Error('--probe requires --live');
const fixture=JSON.parse(await readFile(path.join(root,'tests/fixtures/agent-requests.json'),'utf8')) as {version:number;cases:RequestEvaluationCase[]};
const cases=fixture.cases.filter(c=>!value('--family')||c.family===value('--family'));
if(!cases.length)throw new Error('No matching request cases');
const selected=value('--models')==='all'?TEXT_MODEL_PRESETS.map(p=>p.id):[value('--models')||'ark-text'];
const modelIds=live?selected:['offline'];
const createdAt=new Date().toISOString();
const out=path.resolve(value('--out')||path.join(root,'data/request-evaluations',createdAt.replace(/[:.]/g,'-')+'.json'));
let revision:string|null=null;try{revision=execFileSync('git',['rev-parse','HEAD'],{cwd:root}).toString().trim();}catch{}
const implementation=createHash('sha256');
for(const f of ['intents','creativeRequest','lessonSpec','toolTrace','core','lessonWorkflow'])implementation.update(await readFile(path.join(root,'server',f+'.ts')));
const report:any={createdAt,revision,implementationHash:implementation.digest('hex'),fixtureVersion:fixture.version,layer:probe?'live-semantic-probe':live?'production-route-and-live-fallback':'offline-routing',scope:'Request path, authority, topic and explicit settings. No research, narration, rendering or movie-quality grade.',models:[]};
await mkdir(path.dirname(out),{recursive:true});
for(const id of modelIds){
  const config=live?await getModelConfig('text',id):null;
  if(live&&!config)throw new Error(`Text model ${id} is unavailable; configure it before live evaluation.`);
  const result:any={id,modelId:config?.modelId||null,results:[]};report.models.push(result);let next=0;
  async function worker(){while(next<cases.length){const c=cases[next++],context=requestEvaluationContext(c),events:WorkflowEvent[]=[],started=Date.now();
    const row:any={id:c.id,family:c.family,caseHash:requestCaseHash(c),prompt:c.prompt,expected:c.expected};
    const progress=async(es:WorkflowEvent[])=>{for(const e of es){const i=events.findIndex(v=>v.callId===e.callId);if(i<0)events.push(structuredClone(e));else events[i]=structuredClone(e);}};
    try{
      const route=!live?inferCreationRoute(context):probe?await resolveCreativeRequest(config!,c.prompt,context.history,context.sourceCount,progress):await planCreationRoute(context,async()=>config!,progress);
      if(!route)row.status='deferred';
      else {Object.assign(row,checkRequestContract(c,route,events),{route:traceValue(route,config?[config.apiKey]:[]),status:'checked'});}
    }catch(error){row.status='error';row.passed=false;row.error=traceValue(error instanceof Error?error.message:String(error),config?[config.apiKey]:[]);}
    row.elapsedMs=Date.now()-started;row.workflow=events;result.results.push(row);
    console.log(JSON.stringify({model:id,case:c.id,status:row.status,passed:row.passed,failures:row.checks?.filter((c:any)=>!c.passed).map((c:any)=>c.name),elapsedMs:row.elapsedMs}));
  }}
  await Promise.all(Array.from({length:live?3:1},()=>worker()));
  result.results.sort((a:any,b:any)=>cases.findIndex(c=>c.id===a.id)-cases.findIndex(c=>c.id===b.id));
  const checked=result.results.filter((r:any)=>r.status==='checked'),passed=checked.filter((r:any)=>r.passed).length;
  result.summary={total:cases.length,checked:checked.length,passed,failed:checked.length-passed,errors:result.results.filter((r:any)=>r.status==='error').length,deferred:result.results.filter((r:any)=>r.status==='deferred').length,passRate:passed/cases.length,modelToolCalls:result.results.reduce((n:number,r:any)=>n+r.workflow.filter((e:WorkflowEvent)=>e.tool==='route_video_request').length,0)};
  await writeFile(out,JSON.stringify(report,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify({model:id,...result.summary,report:out}));
}
if(report.models.some((m:any)=>m.summary.failed||m.summary.errors))process.exitCode=1;
