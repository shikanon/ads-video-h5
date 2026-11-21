import type {Express} from 'express';
import {randomUUID,createHash} from 'node:crypto';
import type {MvRecreation} from '../shared/mvRecreation';
import type {MediaItem,Job} from '../shared/types';
import {userOf,type PublicUser} from './auth';
import {validateMvPlan,mvPlanHash} from './mvRecreation';
import type {MediaFolder} from '../shared/mediaFolders';
import {mvFolderSelection} from './mediaFolders';
import {mvTemplateSelection,type MvTemplateInput} from './mvTemplate';
export function mountMvRecreation(app:Express,o:{state:()=>{mediaFolders?:MediaFolder[];mvRecreations?:MvRecreation[];media:MediaItem[];jobs:Job[]};save:()=>Promise<void>;snapshot:(u:PublicUser)=>Promise<unknown>;start:(u:PublicUser,p:MvRecreation,phase:'plan'|'lyrics'|'preview'|'render'|'produce')=>Promise<void>;session:(u:PublicUser)=>Promise<string>;kick:()=>void;removeCache?:(p:MvRecreation)=>Promise<void>;validSession?:(u:PublicUser,id:string)=>boolean;quote?:(u:PublicUser,input:MvTemplateInput,sources:MediaItem[])=>Promise<{points:number;balance:number;pricingHash:string;[key:string]:unknown}>}){
 const rows=()=>o.state().mvRecreations||(o.state().mvRecreations=[]),busy=(p:MvRecreation)=>o.state().jobs.some(j=>j.ownerId===p.ownerId&&j.mvTask?.projectId===p.id&&['queued','running','stopping'].includes(j.status));
 const find=(u:PublicUser,id:string)=>{const p=rows().find(p=>p.ownerId===u.id&&p.id===id);if(!p)throw Object.assign(Error('复刻项目不存在。'),{status:404});return p;};
 const locks=new Map<string,Promise<void>>();
 const wrap=(fn:(q:any,r:any)=>Promise<void>)=>async(q:any,r:any)=>{const key=userOf(q).id,previous=locks.get(key)||Promise.resolve();const next=previous.catch(()=>{}).then(()=>fn(q,r));if(q.method!=='GET')locks.set(key,next);try{await next;}catch(e){r.status((e as any).status||400).json({error:e instanceof Error?e.message:'MV操作失败。'});}finally{if(locks.get(key)===next)locks.delete(key);}};
 app.get('/api/mv-recreations',wrap(async(q,r)=>{const u=userOf(q);r.set('Cache-Control','no-store').json({projects:rows().filter(p=>p.ownerId===u.id)});}));
 app.post('/api/mv-recreations/template/quote',wrap(async(q,r)=>{const u=userOf(q),b=q.body||{},{sources}=mvTemplateSelection(o.state(),u.id,b);if(!o.validSession?.(u,b.sessionId)||!o.quote)throw Error('请重新打开当前画布。');r.set('Cache-Control','no-store').json(await o.quote(u,b,sources));}));
 app.post('/api/mv-recreations/template',wrap(async(q,r)=>{
  const u=userOf(q),b=q.body||{};if(typeof b.requestId!=='string'||!/^[-\w]{16,80}$/.test(b.requestId))throw Error('提交标识无效。');
  const {folder,audio,sources}=mvTemplateSelection(o.state(),u.id,b);if(!o.validSession?.(u,b.sessionId)||!o.quote)throw Error('画布不存在。');
  const hash=createHash('sha256').update(JSON.stringify([b.folderId,b.audioId,b.duration,b.resolution,b.prompt.trim(),b.sessionId,b.position])).digest('hex');
  let p=rows().find(p=>p.ownerId===u.id&&p.createdFromRequestId===b.requestId);
  if(p&&p.templateRequestHash!==hash)throw Object.assign(Error('提交内容已变化，请重新提交。'),{status:409});
  if(p&&o.state().jobs.some(j=>j.ownerId===u.id&&j.mvTask?.projectId===p!.id)){r.json({project:p,state:await o.snapshot(u)});return;}
  if(o.state().jobs.some(j=>j.ownerId===u.id&&j.sessionId===b.sessionId&&['queued','running','stopping'].includes(j.status)))throw Object.assign(Error('当前画布已有任务，请先等待完成。'),{status:409});
  const quote=await o.quote(u,b,sources);if(b.pricingHash!==quote.pricingHash)throw Object.assign(Error('模型价格已变化，请刷新预计积分。'),{status:409});if(quote.balance<quote.points)throw Object.assign(Error('预计积分不足，请缩短时长或减少文件夹素材。'),{status:402});
  if(!p){if(rows().filter(p=>p.ownerId===u.id).length>=100)throw Error('请先整理已有MV项目。');const at=new Date().toISOString();p={id:randomUUID(),ownerId:u.id,sessionId:b.sessionId,name:folder.name+' · 叙事蒙太奇',referenceId:'',audioId:audio.id,sourceIds:sources.map(m=>m.id),duration:b.duration,resolution:b.resolution,editSkill:'narrative-montage',sourceFolderId:folder.id,createdFromRequestId:b.requestId,templateRequestHash:hash,canvasPosition:b.position,instructions:b.prompt.trim(),createdAt:at,updatedAt:at};rows().push(p);}
  await o.start(u,p,'produce');await o.save();r.status(202).json({project:p,state:await o.snapshot(u)});o.kick();
 }));
 app.post('/api/mv-recreations/from-folder',wrap(async(q,r)=>{
  const u=userOf(q),b=q.body||{};if(typeof b.prompt!=='string'||!b.prompt.trim()||b.prompt.length>12000||b.folderId!==undefined&&typeof b.folderId!=='string'||typeof b.requestId!=='string'||!/^[-\w]{16,80}$/.test(b.requestId))throw Error('请写下MV要求并提供有效提交标识。');
  const previous=rows().find(p=>p.ownerId===u.id&&p.createdFromRequestId===b.requestId);if(previous){if(previous.instructions!==b.prompt.trim()||b.folderId&&b.folderId!==previous.sourceFolderId)throw Object.assign(Error('提交内容已改变。'),{status:409});r.json({project:previous,state:await o.snapshot(u)});return;}
  const selection=mvFolderSelection(o.state(),u.id,b.folderId,b.prompt),{folder,ref,song,sourceIds,recipe}=selection;
  if(!ref.duration||ref.duration>600||!song.duration||song.duration<ref.duration-.1)throw Error('参考片最长10分钟，配乐需覆盖完整时长。');
  if(rows().filter(p=>p.ownerId===u.id).length>=100)throw Error('请先整理已有复刻项目。');
  const at=new Date().toISOString(),p:MvRecreation={id:randomUUID(),ownerId:u.id,sessionId:await o.session(u),name:folder.name+' MV',referenceId:ref.id,audioId:song.id,sourceIds:sourceIds.slice(),duration:ref.duration,instructions:b.prompt.trim(),sourceFolderId:folder.id,createdFromRequestId:b.requestId,createdAt:at,updatedAt:at};
  if(recipe?.plan){p.plan=validateMvPlan(recipe.plan,p,o.state().media);p.planHash=mvPlanHash(p.plan);p.evidence=structuredClone(recipe.evidence||{});}
  rows().push(p);await o.save();r.status(201).json({project:p,state:await o.snapshot(u)});
 }));
 app.post('/api/mv-recreations',wrap(async(q,r)=>{
  const u=userOf(q),b=q.body||{},media=o.state().media.filter(m=>m.ownerId===u.id);if(Object.keys(b).some(k=>!['name','referenceId','audioId','sourceIds','instructions'].includes(k))||typeof b.name!=='string'||!b.name.trim()||b.name.length>80||typeof b.instructions!=='string'||b.instructions.length>12000||!Array.isArray(b.sourceIds)||!b.sourceIds.length||b.sourceIds.length>100||new Set(b.sourceIds).size!==b.sourceIds.length||b.sourceIds.includes(b.referenceId)||[b.referenceId,b.audioId,...b.sourceIds].some(id=>typeof id!=='string'||!/^[\w-]{1,128}$/.test(id)))throw Error('请分别选择参考片、配乐和1–100个原素材，参考片不能充当原素材。');
  const ref=media.find(m=>m.id===b.referenceId&&m.kind==='video'),song=media.find(m=>m.id===b.audioId&&['audio','video'].includes(m.kind));if(!ref?.duration||ref.duration>600||!song?.duration||song.duration<ref.duration-.1||song.hasAudio===false||b.sourceIds.some((id:string)=>!media.some(m=>m.id===id&&['image','video'].includes(m.kind))))throw Error('参考片、配乐或原素材不存在、类型不符或配乐时长不足。');
  if(rows().filter(p=>p.ownerId===u.id).length>=100)throw Error('请先整理已有复刻项目。');const at=new Date().toISOString(),sessionId=await o.session(u),p:MvRecreation={id:randomUUID(),ownerId:u.id,sessionId,name:b.name.trim(),referenceId:ref.id,audioId:song.id,sourceIds:b.sourceIds,duration:ref.duration,instructions:b.instructions,createdAt:at,updatedAt:at};rows().push(p);await o.save();r.status(201).json({project:p,state:await o.snapshot(u)});
 }));
 app.patch('/api/mv-recreations/:id',wrap(async(q,r)=>{const p=find(userOf(q),q.params.id);if(busy(p))throw Object.assign(Error('请先停止或等待当前任务。'),{status:409});if(q.body?.plan){if(q.body.expectedHash!==p.planHash)throw Object.assign(Error('分镜已更新，请重新打开。'),{status:409});p.plan=validateMvPlan(q.body.plan,p,o.state().media);p.planHash=mvPlanHash(p.plan);p.approvedHash=undefined;p.artifactId=undefined;p.previewArtifactId=undefined;p.nodeArtifacts={};}else{if(typeof q.body?.name!=='string'||!q.body.name.trim()||q.body.name.length>80)throw Error('名称无效。');p.name=q.body.name.trim();}p.updatedAt=new Date().toISOString();await o.save();r.json({project:p});}));
 for(const phase of ['plan','lyrics','preview','render'] as const)app.post('/api/mv-recreations/:id/'+phase,wrap(async(q,r)=>{const u=userOf(q),p=find(u,q.params.id);if(typeof q.body?.requestId!=='string'||!/^[-\w]{16,80}$/.test(q.body.requestId))throw Error('提交标识无效。');const previous=o.state().jobs.find(j=>j.ownerId===u.id&&j.mvTask?.projectId===p.id&&j.clientRequestId===q.body.requestId);if(previous){if(previous.mvTask?.phase!==phase||(phase!=='plan'&&(previous.mvTask?.planHash!==q.body.planHash||q.body.planHash!==p.planHash)))throw Object.assign(Error('提交内容已改变。'),{status:409});r.json({project:p,state:await o.snapshot(u)});return;}if(busy(p)){r.status(202).json({project:p,state:await o.snapshot(u)});return;}if(phase!=='plan'){if(!p.planHash||q.body?.planHash!==p.planHash)throw Object.assign(Error('分镜已变化，请重新确认。'),{status:409});if(phase!=='lyrics')p.approvedHash=p.planHash;}
  // Admission happens before the response; no background task masquerades as an accepted job.
  if(phase==='render'&&!p.previewArtifactId)throw Object.assign(Error('请先完成并查看本版分镜的样片。'),{status:409});await o.start(u,p,phase);const job=o.state().jobs.slice().reverse().find(j=>j.ownerId===u.id&&j.mvTask?.projectId===p.id&&j.mvTask.phase===phase);if(job){job.clientRequestId=q.body.requestId;if(job.mvTask&&phase!=='plan')job.mvTask.planHash=p.planHash;}await o.save();r.status(202).json({project:p,state:await o.snapshot(u)});o.kick();}));
 app.delete('/api/mv-recreations/:id',wrap(async(q,r)=>{const p=find(userOf(q),q.params.id);if(busy(p))throw Object.assign(Error('请先停止或等待当前任务。'),{status:409});await o.removeCache?.(p);rows().splice(rows().indexOf(p),1);await o.save();r.json({ok:true});}));
}
