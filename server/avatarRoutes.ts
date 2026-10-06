import type { Express } from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import type { AppSettings, AppState, MediaItem, Session } from '../src/types';
import { userOf, type PublicUser } from './auth';
import { detectImage, runFFmpeg } from './core';
import { AVATAR_MAX_BYTES, compileSpriteSheet, readAvatarPng } from './avatarAssets';

interface AvatarRoutesContext {
  media: () => MediaItem[]; mediaDir: string; tmpDir: string;
  save: () => Promise<void>; publicState: (user: PublicUser) => Promise<AppState>;
  settings: (user: PublicUser) => Promise<AppSettings>;
  session: (id: string, ownerId: string) => Session | undefined;
  generate: (session: Session, source: MediaItem) => void | Promise<void>;
  process: () => void;
}
const execFileAsync=promisify(execFile);
const ffprobePath:string=createRequire(import.meta.url)('ffprobe-static').path;
export function mountAvatarRoutes(app: Express, ctx: AvatarRoutesContext) {
  const upload=multer({dest:ctx.tmpDir,limits:{fileSize:AVATAR_MAX_BYTES,files:1}});
  app.post('/api/avatars', upload.single('file'), async (request,response)=>{
    const user=userOf(request), file=request.file;
    if(!file)return response.status(400).json({error:'请选择形象图片。'});
    let target:string|undefined,added:MediaItem|undefined;
    try{
      let bytes=await readFile(file.path); const mime=detectImage(bytes);
      if(!mime)throw new Error('形象图片仅支持 PNG、JPEG 或 WebP。');
      const role=request.body?.role;
      if(!['reference','sprite'].includes(role))throw new Error('请选择上传原图或导入序列帧。');
      if(mime==='image/png')readAvatarPng(bytes);
      else{
        if(role==='sprite')throw new Error('序列帧需要透明 PNG 图片。');
        const {stdout}=await execFileAsync(ffprobePath,['-v','error','-select_streams','v:0','-show_entries','stream=width,height','-of','json',file.path],{timeout:10000,maxBuffer:8000});
        const size=JSON.parse(stdout).streams?.[0];
        if(!size||size.width>8192||size.height>8192||size.width*size.height>16_777_216)throw new Error('形象图片尺寸超过上限。');
        const converted=file.path+'.png';
        try{await runFFmpeg(['-v','error','-y','-i',file.path,'-frames:v','1','-vf','scale=1024:1024:force_original_aspect_ratio=decrease',converted],20_000);bytes=await readFile(converted);readAvatarPng(bytes);}
        finally{await rm(converted,{force:true});}
      }
      const compiled=role==='sprite'?compileSpriteSheet(bytes,{columns:request.body.columns,rows:request.body.rows,frameCount:request.body.frameCount,fps:request.body.fps}):undefined;
      const referenceMediaId=typeof request.body.referenceMediaId==='string'&&request.body.referenceMediaId?request.body.referenceMediaId:undefined;
      if(referenceMediaId&&!ctx.media().some(m=>m.id===referenceMediaId&&m.ownerId===user.id&&m.character?.role==='reference'))throw new Error('形象原图不存在或无权限。');
      const id=randomUUID();target=path.join(ctx.mediaDir,id);
      await writeFile(target,compiled?.bytes||bytes,{mode:0o600});
      const name=typeof request.body.name==='string'?request.body.name.trim().slice(0,60):'';
      added={id,ownerId:user.id,name:name||(role==='reference'?'我的 Q 版形象':'我的形象动画'),mimeType:'image/png',kind:'image',origin:'upload',url:`/api/media/${id}`,createdAt:new Date().toISOString(),character:{role,...(referenceMediaId?{referenceMediaId}:{}),...(compiled?{sprite:compiled.sprite}:{})}};
      ctx.media().push(added);await ctx.save();response.status(201).json(await ctx.publicState(user));
    }catch(error){if(added){const i=ctx.media().indexOf(added);if(i>=0)ctx.media().splice(i,1);}if(target)await rm(target,{force:true});response.status(400).json({error:error instanceof Error?error.message:'形象导入失败。'});}
    finally{await rm(file.path,{force:true});}
  });
  app.post('/api/avatars/:id/generate',async(request,response)=>{
    const user=userOf(request),source=ctx.media().find(m=>m.id===request.params.id&&m.ownerId===user.id&&m.character?.role==='reference');
    const session=ctx.session(String(request.body?.sessionId||''),user.id);
    if(!source||!session)return response.status(404).json({error:'形象原图或会话不存在。'});
    await ctx.generate(session,source);await ctx.save();response.status(202).json(await ctx.publicState(user));ctx.process();
  });
  app.post('/api/avatars/active',async(request,response)=>{
    const user=userOf(request),id=request.body?.mediaId;
    if(id!==null&&(typeof id!=='string'||!ctx.media().some(m=>m.id===id&&m.ownerId===user.id&&m.character?.role==='sprite'&&m.character.sprite)))return response.status(400).json({error:'请选择已完成的形象动画。'});
    (await ctx.settings(user)).authorAvatarId=id;await ctx.save();response.json(await ctx.publicState(user));
  });
}
