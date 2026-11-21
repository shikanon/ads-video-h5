import {randomBytes} from 'node:crypto';
import type {Express} from 'express';
import {userOf} from './auth';

type Kind='media'|'artifact';
interface Playable {mimeType:string;filename?:string;prepare:()=>Promise<string>}
/** A short-lived capability for one owned video, never a login cookie in a URL. */
export function createMediaPlayback(o:{base:string;lookup:(ownerId:string,kind:Kind,id:string)=>Playable|undefined;now?:()=>number}){
 const grants=new Map<string,{ownerId:string;kind:Kind;id:string;expires:number;download:boolean}>(),now=o.now||Date.now;
 return {
  mountPublic(app:Express){app.all('/api/media-playback/:token',async(q,r)=>{
   if(!['GET','HEAD'].includes(q.method))return r.status(405).end();
   const token=String(q.params.token),grant=grants.get(token);if(!grant||grant.expires<=now()){grants.delete(token);return r.status(404).end();}
   const asset=o.lookup(grant.ownerId,grant.kind,grant.id);if(!asset)return r.status(410).end();
   try{const file=await asset.prepare();if(!o.lookup(grant.ownerId,grant.kind,grant.id))return r.status(410).end();r.set({'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'});if(grant.download)r.attachment(asset.filename||'LightMao.mp4');r.type(asset.mimeType);r.sendFile(file,{cacheControl:false,dotfiles:'deny'},error=>{if(error&&!r.headersSent)r.status(502).end();});}catch{if(!r.headersSent)r.status(502).end();}
  });},
  mountOwned(app:Express){app.post('/api/media-playback',(q,r)=>{
   const u=userOf(q),b=q.body||{};if(!['media','artifact'].includes(b.type)||typeof b.id!=='string'||!/^[-\w]{1,128}$/.test(b.id)||b.download!==undefined&&typeof b.download!=='boolean')return r.status(400).json({error:'请选择视频。'});
   if(!o.lookup(u.id,b.type,b.id))return r.status(404).json({error:'视频不存在。'});
   for(const [k,v]of grants)if(v.expires<=now())grants.delete(k);
   while(grants.size>=2048)grants.delete(grants.keys().next().value!);
   const token=randomBytes(32).toString('base64url'),expires=now()+30*60000;grants.set(token,{ownerId:u.id,kind:b.type,id:b.id,expires,download:b.download===true});
   r.set('Cache-Control','no-store').json({url:o.base+'/api/media-playback/'+token,expiresAt:expires});
  });}
 };
}
