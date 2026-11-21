import type {Express} from 'express';
import type {Job,MediaItem,Session} from '../shared/types';
import type {ToolBatch} from '../shared/toolBatches';
import {userOf,type PublicUser} from './auth';
import {stateHash} from './durableState';
import {canvasPoint,displayName} from './lifecycleRoutes';
import {isActiveJob} from '../src/jobStatus';
export function batchViews(batches:ToolBatch[],jobs:Job[],sessions:Session[],ownerId:string){
 return batches.filter(b=>b.ownerId===ownerId).map(b=>{const items=b.items.map((item,index)=>{const job=jobs.find(j=>j.ownerId===ownerId&&j.id===item.jobId);return {index,topic:item.topic,sessionId:item.sessionId,jobId:item.jobId,status:job?.status||(item.starting?'unconfirmed':item.error?'failed':'pending'),error:job?.error||item.error||'',unavailable:!!item.sessionId&&!sessions.some(s=>s.id===item.sessionId)};});return {id:b.id,name:b.name,position:b.position,templateId:b.templateId,templateName:b.templateName,createdAt:b.createdAt,count:items.length,done:items.filter(i=>i.status==='succeeded').length,active:items.some(i=>['queued','running','stopping'].includes(i.status)),failed:items.filter(i=>['failed','cancelled','unconfirmed'].includes(i.status)).length,items};}).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
}
export function mountToolBatchRoutes(app:Express,o:{
 state:()=>{toolBatches?:ToolBatch[];jobs:Job[];media:MediaItem[];sessions:Session[]};
 templates:()=>Array<{id:string;name:string;output?:string}>;save:()=>Promise<void>;snapshot:(u:PublicUser)=>Promise<unknown>;
 start:(u:PublicUser,b:ToolBatch,index:number)=>Promise<{sessionId:string;jobId:string}>;
 stop:(u:PublicUser,sessionId:string)=>void;kick:()=>void;
}){
 const locks=new Map<string,Promise<unknown>>();
 async function locked<T>(owner:string,fn:()=>Promise<T>){const before=locks.get(owner)||Promise.resolve(),next=before.catch(()=>{}).then(fn);locks.set(owner,next);try{return await next;}finally{if(locks.get(owner)===next)locks.delete(owner);}}
 const rows=()=>o.state().toolBatches||(o.state().toolBatches=[]);
 const find=(owner:string,id:string)=>{const b=rows().find(b=>b.ownerId===owner&&b.id===id);if(!b)throw Object.assign(Error('批量项目不存在。'),{status:404});return b;};
 const wrap=(f:(q:any,r:any)=>Promise<void>)=>async(q:any,r:any)=>{try{await f(q,r);}catch(e){r.status((e as any).status||400).json({error:e instanceof Error?e.message:'批量操作未完成。',...((e as any).code?{code:(e as any).code}:{})});}};
 async function startMissing(u:PublicUser,b:ToolBatch){
  for(const [index,item] of b.items.entries()){if(item.jobId)continue;item.starting=true;item.error=undefined;await o.save();try{const made=await o.start(u,b,index);Object.assign(item,made,{starting:false});}catch(e){item.starting=false;item.error=(e instanceof Error?e.message:'未能启动').slice(0,300);}await o.save();}
 }
 app.post('/api/tool-batches',wrap(async(q,r)=>{const u=userOf(q),body=q.body||{};let replay=false;
  await locked(u.id,async()=>{
   if(Object.keys(body).some(k=>!['requestId','name','templateId','topics','attachmentIds','position'].includes(k))||typeof body.requestId!=='string'||!/^[\w-]{16,80}$/.test(body.requestId)||!Array.isArray(body.topics)||body.topics.length<1||body.topics.length>20||body.topics.some((v:any)=>typeof v!=='string'||!v.trim()||v.length>2000)||!Array.isArray(body.attachmentIds)||body.attachmentIds.length>20||new Set(body.attachmentIds).size!==body.attachmentIds.length)throw Error('选择模板，每行填写一个主题；每批1–20条，每条不超过2000字。');
   const name=displayName(body.name||'批量视频',60),template=o.templates().find(t=>t.id===body.templateId&&(!t.output||t.output==='video'));if(!template)throw Error('请选择可制作视频的模板。');
   if(body.attachmentIds.some((id:any)=>!o.state().media.some(m=>m.id===id&&m.ownerId===u.id)))throw Error('素材已删除或无权使用，请重新选择。');
   const position=canvasPoint(body.position,true)||{x:32,y:40},input={name,templateId:template.id,topics:body.topics.map((v:string)=>v.trim()),attachmentIds:body.attachmentIds,position},inputHash=stateHash(input),existing=rows().find(b=>b.ownerId===u.id&&b.requestId===body.requestId);
   if(existing){if(existing.inputHash!==inputHash)throw Object.assign(Error('本批提交内容已变化，请重新确认。'),{status:409});replay=true;return;}
   if(rows().filter(b=>b.ownerId===u.id).length>=200)throw Error('请先整理已有批量项目。');
   const b:ToolBatch={id:stateHash({owner:u.id,requestId:body.requestId}),ownerId:u.id,requestId:body.requestId,inputHash,name,templateId:template.id,templateName:template.name,attachmentIds:[...input.attachmentIds],position,createdAt:new Date().toISOString(),items:input.topics.map((topic:string)=>({topic}))};rows().push(b);await o.save();await startMissing(u,b);
  });r.status(replay?200:202).json({state:await o.snapshot(u)});o.kick();
 }));
 app.post('/api/tool-batches/:id/resume',wrap(async(q,r)=>{const u=userOf(q);await locked(u.id,()=>startMissing(u,find(u.id,q.params.id)));r.json({state:await o.snapshot(u)});o.kick();}));
 app.post('/api/tool-batches/:id/stop',wrap(async(q,r)=>{const u=userOf(q);await locked(u.id,async()=>{for(const i of find(u.id,q.params.id).items)if(i.sessionId)o.stop(u,i.sessionId);await o.save();});r.json({state:await o.snapshot(u)});}));
 app.patch('/api/tool-batches/:id',wrap(async(q,r)=>{const u=userOf(q);if(Object.keys(q.body||{}).some(k=>k!=='name'))throw Error('名称请求无效。');await locked(u.id,async()=>{find(u.id,q.params.id).name=displayName(q.body?.name,60);await o.save();});r.json({state:await o.snapshot(u)});}));
 app.delete('/api/tool-batches/:id',wrap(async(q,r)=>{const u=userOf(q);await locked(u.id,async()=>{const b=find(u.id,q.params.id);if(o.state().jobs.some(j=>j.ownerId===u.id&&b.items.some(i=>i.jobId===j.id)&&isActiveJob(j)))throw Object.assign(Error('请先停止或等待本批任务完成。'),{status:409});rows().splice(rows().indexOf(b),1);for(const s of o.state().sessions)if(s.ownerId===u.id&&s.toolBatchId===b.id)s.toolBatchId=undefined;await o.save();});r.json({state:await o.snapshot(u)});}));
}
