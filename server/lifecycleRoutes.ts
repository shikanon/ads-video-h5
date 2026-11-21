import type {Express} from 'express';
import {userOf,type PublicUser} from './auth';
import type {Artifact,Job,MediaItem,Session} from '../shared/types';
import type {ToolWorkspace} from '../shared/toolWorkspace';
import type {CanvasProfile} from './workCanvases';
import {isActiveJob} from '../src/jobStatus';

export function displayName(value:unknown,max=80){
  if(typeof value!=='string'||!value.trim()||Array.from(value.trim()).length>max||/[\u0000-\u001f\u007f]/.test(value))throw Object.assign(Error('请输入1–'+max+'字的名称。'),{status:400});
  return value.trim();
}
export function detachArtifact(s:{artifacts:Artifact[];sessions:Session[];profiles?:Record<string,CanvasProfile>},ownerId:string,id:string){
  const index=s.artifacts.findIndex(a=>a.ownerId===ownerId&&a.id===id);if(index<0)return;
  s.artifacts.splice(index,1);for(const session of s.sessions.filter(s=>s.ownerId===ownerId)){for(const m of session.messages)m.artifactIds=(m.artifactIds||[]).filter(value=>value!==id);if(session.toolWorkspace)session.toolWorkspace.nodes=session.toolWorkspace.nodes.filter(n=>n.sourceKind!=='artifact'||n.sourceId!==id);}
  for(const canvas of Object.values(s.profiles?.[ownerId]?.toolCanvases||{}))if(canvas)canvas.nodes=canvas.nodes.filter(n=>n.sourceKind!=='artifact'||n.sourceId!==id);
}
export function canvasPoint(value:any,optional=false):{x:number;y:number}|undefined{
  if(optional&&value===undefined)return;
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['x','y'].includes(k))||!['x','y'].every(k=>typeof value[k]==='number'&&Number.isFinite(value[k])&&Math.abs(value[k])<=1e9))throw Object.assign(Error('画布位置无效。'),{status:400});
  return {x:value.x,y:value.y};
}
export function validateWorkspace(value:any):ToolWorkspace{
  const fail=()=>{throw Object.assign(Error('画布数据无效，请刷新后重试。'),{status:400});};
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['version','category','templateId','draft','attachmentIds','nodes','updatedAt','output','camera','nextPosition','includeHistory','mvSettings'].includes(k))||value.output!==undefined&&!['static','dynamic'].includes(value.output)||value.version!==1||!['stickers','video'].includes(value.category)||value.templateId!==null&&(typeof value.templateId!=='string'||!/^[a-z][a-z0-9-]{0,80}$/.test(value.templateId))||typeof value.draft!=='string'||value.draft.length>20000||!Array.isArray(value.attachmentIds)||value.attachmentIds.length>20||new Set(value.attachmentIds).size!==value.attachmentIds.length||value.attachmentIds.some((id:any)=>typeof id!=='string'||!id||id.length>180)||!Array.isArray(value.nodes)||value.nodes.length>5000||value.includeHistory!==undefined&&typeof value.includeHistory!=='boolean')fail();
  const mv=value.mvSettings;if(mv!==undefined&&(!mv||Object.keys(mv).some(k=>!['folderId','audioId','duration','resolution'].includes(k))||!['folderId','audioId'].every(k=>typeof mv[k]==='string'&&/^[\w-]{0,128}$/.test(mv[k]))||!Number.isInteger(mv.duration)||mv.duration<5||mv.duration>600||![480,720,1080].includes(mv.resolution)))fail();
  const ids=new Set();
  for(const n of value.nodes){
    if(!n||Object.keys(n).some(k=>!['id','sourceId','sourceKind','itemId','x','y','width','height','hidden','scale','z'].includes(k))||typeof n.id!=='string'||!n.id||n.id.length>220||ids.has(n.id)||typeof n.sourceId!=='string'||!n.sourceId||n.sourceId.length>180||!['media','artifact','sticker'].includes(n.sourceKind)||n.itemId!==undefined&&(typeof n.itemId!=='string'||!/^(soft|round|\d{2})$/.test(n.itemId))||n.hidden!==undefined&&typeof n.hidden!=='boolean'||n.scale!==undefined&&(typeof n.scale!=='number'||!Number.isFinite(n.scale)||n.scale<.25||n.scale>4)||n.z!==undefined&&(!Number.isInteger(n.z)||n.z<0||n.z>1e9)||!['x','y','width','height'].every(k=>typeof n[k]==='number'&&Number.isFinite(n[k]))||Math.abs(n.x)>1e9||Math.abs(n.y)>1e9||n.width<48||n.width>2000||n.height<48||n.height>2000)fail();ids.add(n.id);
  }
  let camera:ToolWorkspace['camera'];if(value.camera!==undefined){const c=value.camera;if(!c||Object.keys(c).some(k=>!['x','y','zoom'].includes(k))||typeof c.zoom!=='number'||!Number.isFinite(c.zoom)||c.zoom<1e-7||c.zoom>4)fail();camera={...canvasPoint({x:c.x,y:c.y})!,zoom:c.zoom};}
  const nextPosition=canvasPoint(value.nextPosition,true);
  return {...(mv?{mvSettings:{...mv}}:{}),version:1,output:value.output||'static',category:value.category,templateId:value.templateId,draft:value.draft,attachmentIds:[...value.attachmentIds],nodes:value.nodes.map((n:any)=>({...n})),...(camera?{camera}:{}),...(nextPosition?{nextPosition}:{}),includeHistory:value.includeHistory!==false,updatedAt:new Date().toISOString()};
}
export function mountLifecycleRoutes(app:Express,o:{
  state:()=>{sessions:Session[];media:MediaItem[];artifacts:Artifact[];jobs:Job[]};
  save:()=>Promise<void>; snapshot:(u:PublicUser)=>Promise<unknown>;canvas?:(u:PublicUser,w:ToolWorkspace)=>Promise<void>;
  stickerOwner:(ownerId:string,id:string)=>Promise<unknown>;
}){
  const route=(fn:(q:any,r:any)=>Promise<unknown>)=>async(q:any,r:any)=>{try{await fn(q,r);}catch(e){r.status((e as any).status||400).json({error:e instanceof Error?e.message:'操作未完成。'});}};
  const missing=()=>{throw Object.assign(Error('内容不存在或已删除。'),{status:404});};
  app.patch('/api/sessions/:id',route(async(q,r)=>{const u=userOf(q),s=o.state().sessions.find(s=>s.id===q.params.id&&s.ownerId===u.id);if(!s)return missing();if(Object.keys(q.body||{}).some(k=>k!=='title'))throw Error('名称请求无效。');s.title=displayName(q.body?.title);s.updatedAt=new Date().toISOString();await o.save();r.json(await o.snapshot(u));}));
  app.patch('/api/media/:id',route(async(q,r)=>{const u=userOf(q),m=o.state().media.find(m=>m.id===q.params.id&&m.ownerId===u.id);if(!m)return missing();if(Object.keys(q.body||{}).some(k=>k!=='name'))throw Error('名称请求无效。');m.name=displayName(q.body?.name);await o.save();r.json(await o.snapshot(u));}));
  app.patch('/api/artifacts/:id',route(async(q,r)=>{const u=userOf(q),a=o.state().artifacts.find(a=>a.id===q.params.id&&a.ownerId===u.id);if(!a)return missing();if(Object.keys(q.body||{}).some(k=>k!=='name'))throw Error('名称请求无效。');a.name=displayName(q.body?.name);await o.save();r.json(await o.snapshot(u));}));
  app.delete('/api/artifacts/:id',route(async(q,r)=>{const u=userOf(q),s=o.state(),a=s.artifacts.find(a=>a.id===q.params.id&&a.ownerId===u.id);if(!a)return missing();if(s.jobs.some(j=>j.ownerId===u.id&&j.sessionId===a.sessionId&&isActiveJob(j)))throw Object.assign(Error('请先停止或等待当前项目任务完成。'),{status:409});
    detachArtifact(s,u.id,a.id);await o.save();r.json(await o.snapshot(u));
  }));
  app.patch('/api/sessions/:id/workspace',route(async(q,r)=>{const u=userOf(q),s=o.state(),session=s.sessions.find(s=>s.id===q.params.id&&s.ownerId===u.id);if(!session)return missing();if(session.archivedAt)throw Object.assign(Error('请先取消项目归档。'),{status:409});const workspace=validateWorkspace(q.body);
    const media=s.media.filter(m=>m.ownerId===u.id),artifacts=s.artifacts.filter(a=>a.ownerId===u.id);
    if(workspace.attachmentIds.some(id=>!media.some(m=>m.id===id)))throw Object.assign(Error('素材已删除，请重新选择。'),{status:409});
    const checkedStickers=new Set<string>();
    for(const node of workspace.nodes){if(node.sourceKind==='media'&&!media.some(m=>m.id===node.sourceId)||node.sourceKind==='artifact'&&!artifacts.some(a=>a.id===node.sourceId))throw Object.assign(Error('画布内容已删除，请刷新。'),{status:409});if(node.sourceKind==='sticker'&&!checkedStickers.has(node.sourceId)){await o.stickerOwner(u.id,node.sourceId);checkedStickers.add(node.sourceId);}}
    session.toolWorkspace=workspace;session.mode='work';session.updatedAt=workspace.updatedAt;await o.canvas?.(u,workspace);await o.save();r.json(await o.snapshot(u));
  }));
}
