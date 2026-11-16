import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir, rename } from 'node:fs/promises';
import path from 'node:path';
import type { Express } from 'express';
import { userOf } from './auth';
import type { StickerStudio } from './stickerStudio';
import { fileDigest } from './artifactIntegrity';
interface Share {token:string;ownerId:string;projectId:string;name:string;mode:'static'|'dynamic';styleId:string;items:Array<{id:string;files:Record<string,string>}>;revoked:boolean;createdAt:string;}
export function createStickerShares(dataDir:string,studio:StickerStudio,base=''){
 const root=path.join(dataDir,'sticker-shares'),valid=(token:string)=>/^[a-f0-9]{48}$/.test(token);
 async function load(token:string):Promise<Share>{if(!valid(token))throw Error('分享不存在。');const s=JSON.parse(await readFile(path.join(root,token+'.json'),'utf8'));if(s.token!==token||s.revoked)throw Error('分享已关闭。');return s;}
 const save=async(s:Share)=>{await mkdir(root,{recursive:true,mode:0o700});const file=path.join(root,s.token+'.json'),tmp=file+'.tmp';await writeFile(tmp,JSON.stringify(s),{mode:0o600});await rename(tmp,file);};
 async function create(ownerId:string,id:string){
  const project=await studio.load(ownerId,id),view=await studio.view(ownerId,id);if(!view.previewHash)throw Error('先完成样张，再分享作品预览。');
  const items=[];for(const item of view.completed){const files:Record<string,string>={};for(const file of ['thumb.png',project.recipe.mode==='static'?'still.png':'animation.gif'])files[file]=await fileDigest(path.join(studio.folder(ownerId,id),'assets','pack',item.id,file));items.push({id:item.id,files});}
  const share:Share={token:randomBytes(24).toString('hex'),ownerId,projectId:id,name:project.recipe.name,mode:project.recipe.mode,styleId:project.recipe.styleId||'custom',items,revoked:false,createdAt:new Date().toISOString()};await save(share);return {token:share.token};
 }
 async function revoke(ownerId:string,id:string,token:string){const s=await load(token);if(s.ownerId!==ownerId||s.projectId!==id)throw Error('分享不存在。');s.revoked=true;await save(s);}
 function mountPublic(app:Express){
  app.get('/api/sticker-shares/:token',async(q,r)=>{try{const s=await load(q.params.token);r.set('Cache-Control','no-store').json({share:{token:s.token,name:s.name,mode:s.mode,styleId:s.styleId,count:s.items.length,items:s.items.map(item=>({id:item.id,thumbnailUrl:base+`/api/sticker-shares/${s.token}/items/${item.id}/thumb`,previewUrl:base+`/api/sticker-shares/${s.token}/items/${item.id}/preview`}))}});}catch{r.status(404).json({error:'作品分享已关闭或不存在，请向好友获取新的分享。'});}});
  app.get('/api/sticker-shares/:token/items/:id/:kind',async(q,r)=>{try{const s=await load(q.params.token),item=s.items.find(i=>i.id===q.params.id),file=q.params.kind==='thumb'?'thumb.png':q.params.kind==='preview'?(s.mode==='static'?'still.png':'animation.gif'):'';if(!item||!file||!item.files[file])throw Error();const source=path.join(studio.folder(s.ownerId,s.projectId),'assets','pack',item.id,file);if(await fileDigest(source)!==item.files[file])throw Error();r.set('Cache-Control','no-store').sendFile(source);}catch{r.status(404).end();}});
 }
 function mountPrivate(app:Express){
  app.get('/api/sticker-projects/:id/shares',async(q,r)=>{try{const owner=userOf(q).id;await studio.load(owner,q.params.id);const shares=[];for(const name of await readdir(root).catch(()=>[])){if(!/^[a-f0-9]{48}\.json$/.test(name))continue;try{const s=await load(name.slice(0,-5));if(s.ownerId===owner&&s.projectId===q.params.id)shares.push({token:s.token,createdAt:s.createdAt});}catch{}}r.set('Cache-Control','no-store').json({shares});}catch{r.status(404).json({error:'项目不存在。'});}});
  app.post('/api/sticker-projects/:id/shares',async(q,r)=>{try{r.json(await create(userOf(q).id,q.params.id));}catch(error){r.status(400).json({error:error instanceof Error?error.message:'分享创建失败。'});}});
  app.delete('/api/sticker-projects/:id/shares/:token',async(q,r)=>{try{await revoke(userOf(q).id,q.params.id,q.params.token);r.json({ok:true});}catch{r.status(404).json({error:'分享不存在。'});}});
 }
 return {create,revoke,load,mountPublic,mountPrivate};
}
