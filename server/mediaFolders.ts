import type {Express} from 'express';
import {randomUUID} from 'node:crypto';
import {userOf,type PublicUser} from './auth';
import type {MediaItem} from '../shared/types';
import type {MediaFolder} from '../shared/mediaFolders';
import type {MvRecreation} from '../shared/mvRecreation';
export interface FolderState {media:MediaItem[];mediaFolders?:MediaFolder[];mvRecreations?:MvRecreation[]}
export function mvFolderSelection(state:FolderState,ownerId:string,folderId:string|undefined,prompt:string){
 const folders=(state.mediaFolders||[]).filter(f=>f.ownerId===ownerId);
 const matches=folderId?folders.filter(f=>f.id===folderId):folders.filter(f=>prompt.includes(f.name));
 if(matches.length!==1)throw Error(matches.length?'匹配到多个文件夹，请点选本次使用的文件夹。':'请先选择素材文件夹，或在要求中写出完整文件夹名称。');
 const folder=matches[0],media=state.media.filter(m=>m.ownerId===ownerId&&m.folderId===folder.id);
 const ref=media.find(m=>m.id===folder.mv?.referenceId&&m.kind==='video'),song=media.find(m=>m.id===folder.mv?.audioId&&['video','audio'].includes(m.kind));
 if(!ref)throw Error('请在「'+folder.name+'」中将一个视频设为MV参考片。');
 if(!song||song.hasAudio===false)throw Error('请在「'+folder.name+'」中设置MV配乐。');
 const recipe=folder.mv?.recipeProjectId?(state.mvRecreations||[]).find(p=>p.ownerId===ownerId&&p.id===folder.mv!.recipeProjectId&&p.referenceId===ref.id&&p.audioId===song.id&&p.plan):undefined;
 if(folder.mv?.recipeProjectId&&!recipe)throw Error('已保存的原工程不再可用，请重新设置或清除原工程。');
 const sourceIds=recipe?recipe.sourceIds:media.filter(m=>['image','video'].includes(m.kind)&&m.id!==ref.id&&m.id!==song.id).map(m=>m.id);
 if(!sourceIds.length||sourceIds.length>100||sourceIds.some(id=>!media.some(m=>m.id===id)))throw Error('请在文件夹中保留本次制作的1–100项原素材；原工程素材不能缺失。');
 return {folder,ref,song,sourceIds,recipe};
}
export function mountMediaFolders(app:Express,o:{state:()=>FolderState;save:()=>Promise<void>;snapshot:(u:PublicUser)=>Promise<unknown>}){
 const rows=()=>o.state().mediaFolders||(o.state().mediaFolders=[]),locks=new Map<string,Promise<void>>();
 const wrap=(fn:(q:any,r:any)=>Promise<void>)=>async(q:any,r:any)=>{const owner=userOf(q).id,previous=locks.get(owner)||Promise.resolve(),next=previous.catch(()=>{}).then(()=>fn(q,r));locks.set(owner,next);try{await next;}catch(e){r.status((e as any).status||400).json({error:(e as Error).message});}finally{if(locks.get(owner)===next)locks.delete(owner);}};
 const find=(owner:string,id:string)=>{const f=rows().find(f=>f.id===id&&f.ownerId===owner);if(!f)throw Object.assign(Error('文件夹不存在。'),{status:404});return f;};
 const name=(owner:string,value:any,id?:string)=>{if(typeof value!=='string'||!value.trim()||value.trim().length>40||/[\u0000-\u001f]/.test(value))throw Error('文件夹名称需为1–40字。');const n=value.trim();if(rows().some(f=>f.ownerId===owner&&f.id!==id&&f.name===n))throw Error('已有同名文件夹，请换个名称。');return n;};
 app.post('/api/media-folders',wrap(async(q,r)=>{const u=userOf(q);if(rows().filter(f=>f.ownerId===u.id).length>=100)throw Error('最多100个文件夹，请先整理。');const at=new Date().toISOString();rows().push({id:randomUUID(),ownerId:u.id,name:name(u.id,q.body?.name),createdAt:at,updatedAt:at});await o.save();r.status(201).json(await o.snapshot(u));}));
 app.patch('/api/media-folders/:id',wrap(async(q,r)=>{const u=userOf(q),f=find(u.id,q.params.id),b=q.body||{};if(Object.keys(b).some(k=>!['name','mv'].includes(k))||!Object.keys(b).length)throw Error('文件夹修改内容无效。');let n=f.name,mv=f.mv;
  if(b.name!==undefined)n=name(u.id,b.name,f.id);
  if(b.mv!==undefined){if(!b.mv||typeof b.mv!=='object'||Array.isArray(b.mv)||Object.keys(b.mv).some(k=>!['referenceId','audioId','recipeProjectId'].includes(k)))throw Error('MV文件夹设置无效。');mv={...f.mv};for(const k of ['referenceId','audioId','recipeProjectId'] as const){const v=b.mv[k];if(v===undefined)continue;if(v===null){delete mv[k];continue;}if(typeof v!=='string')throw Error('MV设置无效。');if(k==='recipeProjectId'){if(!o.state().mvRecreations?.some(p=>p.id===v&&p.ownerId===u.id&&p.plan))throw Error('原工程不存在。');}else if(!o.state().media.some(m=>m.id===v&&m.ownerId===u.id&&m.folderId===f.id&&(k==='referenceId'?m.kind==='video':['video','audio'].includes(m.kind))))throw Error('请选择文件夹内有效的参考片或配乐。');mv[k]=v;}}
  f.name=n;f.mv=mv;f.updatedAt=new Date().toISOString();await o.save();r.json(await o.snapshot(u));
 }));
 app.post('/api/media-folders/assign',wrap(async(q,r)=>{const u=userOf(q),b=q.body||{},ids=b.mediaIds;if(!Array.isArray(ids)||!ids.length||ids.length>500||new Set(ids).size!==ids.length||ids.some(id=>!o.state().media.some(m=>m.id===id&&m.ownerId===u.id)))throw Error('请选择账号内的1–500个素材。');if(b.folderId!==null)find(u.id,b.folderId);for(const id of ids){const m=o.state().media.find(m=>m.id===id&&m.ownerId===u.id)!;if(b.folderId===null)delete m.folderId;else m.folderId=b.folderId;}await o.save();r.json(await o.snapshot(u));}));
 app.delete('/api/media-folders/:id',wrap(async(q,r)=>{const u=userOf(q),f=find(u.id,q.params.id);for(const m of o.state().media)if(m.ownerId===u.id&&m.folderId===f.id)delete m.folderId;rows().splice(rows().indexOf(f),1);await o.save();r.json(await o.snapshot(u));}));
}
