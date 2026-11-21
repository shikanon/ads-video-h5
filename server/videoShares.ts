import {randomBytes,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,rm,access} from 'node:fs/promises';
import path from 'node:path';
import type {Express} from 'express';
import type {Artifact} from '../shared/types';
import {userOf} from './auth';
import {fileDigest} from './artifactIntegrity';
import {runFFmpeg} from './core';
interface Share {token:string;ownerId:string;artifactId:string;name:string;hash:string;createdAt:string;revoked:boolean}
export function createVideoShares(o:{dataDir:string;base:string;artifact:(ownerId:string,id:string)=>Artifact|undefined;prepare:(a:Artifact)=>Promise<string>}){
 const root=path.join(o.dataDir,'video-shares');
 async function load(token:string):Promise<Share>{if(!/^[a-f0-9]{48}$/.test(token))throw Error('分享无效。');const s=JSON.parse(await readFile(path.join(root,token+'.json'),'utf8'));if(s.token!==token||s.revoked||!o.artifact(s.ownerId,s.artifactId))throw Error('分享已关闭。');return s;}
 async function save(s:Share){await mkdir(root,{recursive:true,mode:0o700});const f=path.join(root,s.token+'.json'),t=f+'.'+randomUUID()+'.tmp';await writeFile(t,JSON.stringify(s),{mode:0o600});await rename(t,f);}
 async function source(s:Share){const a=o.artifact(s.ownerId,s.artifactId);if(!a)throw Error('作品已删除。');const file=await o.prepare(a);if(await fileDigest(file)!==s.hash)throw Error('作品已更新。');return file;}
 async function create(ownerId:string,id:string){const a=o.artifact(ownerId,id);if(!a)throw Error('请选择已完成的视频作品。');const s:Share={token:randomBytes(24).toString('hex'),ownerId,artifactId:id,name:a.name,hash:await fileDigest(await o.prepare(a)),createdAt:new Date().toISOString(),revoked:false};await save(s);return {token:s.token,coverUrl:o.base+'/api/video-shares/'+s.token+'/cover'};}
 function mountPublic(app:Express){
  app.get('/api/video-shares/:token',async(q,r)=>{r.set('Cache-Control','no-store');try{const s=await load(q.params.token);r.json({share:{name:s.name,coverUrl:o.base+'/api/video-shares/'+s.token+'/cover',videoUrl:o.base+'/api/video-shares/'+s.token+'/video'}});}catch{r.status(404).json({error:'视频分享已关闭或作品已删除。'});}});
  app.get('/api/video-shares/:token/video',async(q,r)=>{try{const s=await load(q.params.token),file=await source(s);await load(q.params.token);r.set({'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}).type('mp4').sendFile(file,{cacheControl:false});}catch{r.status(404).end();}});
  app.get('/api/video-shares/:token/cover',async(q,r)=>{let temp='';r.set('Cache-Control','no-store');try{const s=await load(q.params.token),file=path.join(root,s.token+'-cover.png');try{await access(file);}catch{temp=file+'.'+randomUUID()+'.png';await runFFmpeg(['-v','error','-y','-i',await source(s),'-vf','scale=600:480:force_original_aspect_ratio=decrease,pad=600:480:(ow-iw)/2:(oh-ih)/2:color=0xfff9ee','-frames:v','1',temp]);await rename(temp,file);}r.type('png').sendFile(file);}catch{r.status(404).end();}finally{if(temp)await rm(temp,{force:true});}});
 }
 function mountPrivate(app:Express){
  app.post('/api/artifacts/:id/shares',async(q,r)=>{try{r.json(await create(userOf(q).id,q.params.id));}catch(e){r.status(400).json({error:e instanceof Error?e.message:'分享创建失败。'});}});
  app.delete('/api/artifacts/:id/shares/:token',async(q,r)=>{try{const s=await load(q.params.token);if(s.ownerId!==userOf(q).id||s.artifactId!==q.params.id)throw Error();s.revoked=true;await save(s);r.json({ok:true});}catch{r.status(404).json({error:'分享不存在。'});}});
 }
 return {load,create,mountPublic,mountPrivate};
}
