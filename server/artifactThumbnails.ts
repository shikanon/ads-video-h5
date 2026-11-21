import {randomUUID} from 'node:crypto';
import {mkdir,access,rename,rm} from 'node:fs/promises';
import path from 'node:path';
import type {Express} from 'express';
import type {Artifact} from '../shared/types';
import {userOf} from './auth';
import {runFFmpeg} from './core';
export function mountArtifactThumbnails(app:Express,o:{directory:string;lookup:(ownerId:string,id:string)=>Artifact|undefined;prepare:(a:Artifact)=>Promise<string>}){
 const pending=new Map<string,Promise<void>>();
 app.get('/api/artifacts/:id/thumbnail',async(q,r)=>{
  const owner=userOf(q).id,a=o.lookup(owner,q.params.id);if(!a||a.kind!=='video'||!/^[-\w]{1,128}$/.test(a.id))return r.status(404).end();const file=path.join(o.directory,a.id+'.jpg');
  try{await mkdir(o.directory,{recursive:true,mode:0o700});try{await access(file);}catch{
   let p=pending.get(a.id);if(!p){p=(async()=>{const source=await o.prepare(a),temp=file+'.'+randomUUID()+'.jpg';try{await runFFmpeg(['-v','error','-y','-ss',String(Math.min(10,(a.duration||1)/3)),'-i',source,'-frames:v','1','-vf','scale=640:480:force_original_aspect_ratio=decrease','-q:v','3',temp],30000);if(!o.lookup(owner,a.id))throw Error('作品已删除。');await rename(temp,file);}finally{await rm(temp,{force:true});}})();pending.set(a.id,p);const clear=()=>{if(pending.get(a.id)===p)pending.delete(a.id);};p.then(clear,clear);}await p;
  }if(!o.lookup(owner,a.id))return r.status(404).end();r.set('Cache-Control','private, no-store').type('jpeg').sendFile(file);}catch{if(!r.headersSent)r.status(502).json({error:'作品封面暂不可用，请重试。'});}
 });
}
