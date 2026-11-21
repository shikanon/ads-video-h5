import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';
import type {Credits} from './credits';
import type {Job,Artifact} from '../shared/types';

export interface SharedWork {ownerId:string;key:string;taskIds:string[];complete:boolean}
interface Attribution {viewerId:string;identity:string;token:string;kind:'sticker'|'video';work:SharedWork;ceiling:number;at:number;jobId?:string}
interface Registry {version:1;rows:Attribution[];rewarded?:string[]}
// Opening a card or reporting a successful share is never qualifying use.
// Attribution starts only at the authenticated "make my own" action; a newly
// completed production with a newly created output is required afterwards.
export function createWorkShareRewards(o:{dataDir:string;credits:Credits;identity:(id:string)=>{appId:string;openId:string}|undefined;resolve:(kind:'sticker'|'video',token:string)=>Promise<SharedWork>;state:()=>{jobs:Job[];artifacts:Artifact[]};stickerOutput?:(job:Job)=>Promise<boolean>;now?:()=>number}){
 const file=path.join(o.dataDir,'work-share-rewards.json'),now=o.now||Date.now;let store:Registry={version:1,rows:[]},tail=Promise.resolve();
 const identity=(id:string)=>{const v=o.identity(id);return v?createHash('sha256').update(JSON.stringify([v.appId,v.openId])).digest('hex'):'';};
 async function load(){try{const v=JSON.parse(await readFile(file,'utf8'));if(v.version!==1||!Array.isArray(v.rows))throw Error('分享使用记录无效，不能重置。');store={...v,rewarded:v.rewarded||[]};}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}}
 function transaction<T>(fn:(draft:Registry)=>Promise<T>){const next=tail.then(async()=>{const draft=structuredClone(store),result=await fn(draft);if(JSON.stringify(draft)!==JSON.stringify(store)){await mkdir(o.dataDir,{recursive:true});const temp=file+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(draft),{mode:0o600});await rename(temp,file);store=draft;}return result;});tail=next.then(()=>{},()=>{});return next;}
 async function attribute(viewerId:string,kind:'sticker'|'video',token:string){
  const work=await o.resolve(kind,token),viewer=identity(viewerId),owner=identity(work.ownerId);
  if(!viewer||!owner||viewer===owner||!work.complete)return;
  const ceiling=await o.credits.workSpend(work.ownerId,work.taskIds);if(!ceiling)return;
  return transaction(async draft=>{
   if(draft.rewarded?.includes(work.key))return;
   if(draft.rows.some(r=>r.identity===viewer&&r.work.key===work.key))return;
   // Only the latest explicit work choice may receive the next production.
   draft.rows=draft.rows.filter(r=>r.jobId||r.identity!==viewer);
   draft.rows.push({viewerId,identity:viewer,kind,token,work,ceiling,at:now()});
  });
 }
 async function settle(){return transaction(async draft=>{
  const {jobs,artifacts}=o.state(),used=new Set(draft.rows.map(r=>r.jobId).filter(Boolean));
  for(const row of draft.rows){
   if(row.jobId||now()-row.at>7*86400000||identity(row.viewerId)!==row.identity||!identity(row.work.ownerId)||identity(row.work.ownerId)===row.identity)continue;
   let current:SharedWork;try{current=await o.resolve(row.kind,row.token);}catch{continue;}
   if(!current.complete||current.key!==row.work.key||current.ownerId!==row.work.ownerId)continue;
   for(const job of jobs.filter(j=>j.ownerId===row.viewerId&&j.status==='succeeded'&&j.interaction==='create'&&j.creditTaskId&&!used.has(j.id)&&Date.parse(j.createdAt)>row.at)){
    const output=artifacts.some(a=>a.id===job.artifactId&&a.ownerId===row.viewerId&&a.sessionId===job.sessionId&&a.messageId===job.messageId&&Date.parse(a.createdAt)>row.at)||await o.stickerOutput?.(job);
    if(output){row.jobId=job.id;used.add(job.id);break;}
   }
  }
  const keys=new Set(draft.rows.filter(r=>r.jobId).map(r=>r.work.key));
  for(const key of keys){if(draft.rewarded?.includes(key))continue;const rows=draft.rows.filter(r=>r.work.key===key&&r.jobId);if(new Set(rows.map(r=>r.identity)).size<2)continue;const first=rows[0];let current:SharedWork;try{current=await o.resolve(first.kind,first.token);}catch{continue;}if(current.complete&&current.key===key&&current.ownerId===first.work.ownerId){await o.credits.rewardWork(current.ownerId,key,first.work.taskIds,Math.min(...rows.map(r=>r.ceiling)));(draft.rewarded||=[]).push(key);}}
 });}
 return {load,attribute,settle};
}
