import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {atomicStateWrite,stateHash,withFileLock} from './durableState';
import {taskSpecHash} from './taskContract';
import type {TaskSpec} from '../shared/taskRuntime';

// Only an explicit retry of a revalidated sticker project can open a new
// execution window. External-effect receipts and cumulative budgets survive.
export async function prepareStickerExecutionRetry(o:{directory:string;spec:TaskSpec;environmentHash:string;attemptId:string;timeoutMs:number;validate:()=>Promise<string>;assertCurrent:()=>void}){
 if(!/^[a-f0-9-]{36}$/.test(o.attemptId)||!Number.isFinite(o.timeoutMs)||o.timeoutMs<=0)throw Error('表情续做执行窗口无效。');
 const file=path.join(o.directory,'run.json');
 return withFileLock(file,async()=>{
  let raw:string;try{raw=await readFile(file,'utf8');}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error;}
  const old=JSON.parse(raw);
  if(old.contractHash!==taskSpecHash(o.spec))throw Error('表情任务的原制作要求已变化，请重新确认角色与样张。');
  if(!Number.isInteger(old.calls)||old.calls<0||!Array.isArray(old.actions)||!Array.isArray(old.plan)||!Array.isArray(old.checkpoints)||old.spentMicros!==undefined&&(!Number.isFinite(old.spentMicros)||old.spentMicros<0))throw Error('表情执行记录损坏，已停止续做，请联系管理员。');
  if(old.stickerRetry?.attemptId===o.attemptId)return;
  o.assertCurrent();const projectHash=await o.validate();o.assertCurrent();
  const previousRunHash=stateHash(raw),history=path.join(o.directory,'retry-history');await mkdir(history,{recursive:true,mode:0o700});
  const archived=path.join(history,previousRunHash+'.json');
  try{await writeFile(archived,raw,{flag:'wx',mode:0o600});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST'||await readFile(archived,'utf8')!==raw)throw error;}
  const next={...old,environmentHash:o.environmentHash,deadlineAt:Date.now()+o.timeoutMs,stickerRetry:{attemptId:o.attemptId,projectHash,previousRunHash,previousEnvironmentHash:old.environmentHash,at:new Date().toISOString()}};
  if(old.environmentHash!==o.environmentHash){
   next.plan=old.plan.map((step:any)=>({id:step.id,dependsOn:step.dependsOn,status:'pending'}));next.checkpoints=[];delete next.evidence;delete next.dependencies;
  }
  await atomicStateWrite(file,next);
 });
}
