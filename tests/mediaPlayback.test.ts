import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {mkdtemp,open,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createMediaPlayback} from '../server/mediaPlayback';
import {capturePage,waitFor} from './fixtures/nativeClient';

test('owned large videos stream ranges with expiring file-scoped access, while issuance and deleted files stay protected',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'video-playback-'));t.after(()=>rm(dir,{recursive:true,force:true}));const file=path.join(dir,'large.mp4'),f=await open(file,'w');await f.write(Buffer.from('abcdefgh'));await f.truncate(210*1024*1024);await f.close();let now=0,present=true,prepared=0;
 const app=express(),playback=createMediaPlayback({base:'',now:()=>now,lookup:(owner,kind,id)=>owner==='a'&&kind==='artifact'&&id==='video'&&present?{mimeType:'video/mp4',prepare:async()=>{prepared++;return file;}}:undefined});
 playback.mountPublic(app);app.use(express.json(),(q,r,next)=>{if(!q.get('x-owner')){r.status(401).end();return;}(q as any).user={id:q.get('x-owner')};next();});playback.mountOwned(app);
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));t.after(()=>new Promise<void>(r=>{server.closeAllConnections();server.close(()=>r());}));const base='http://127.0.0.1:'+(server.address() as any).port;
 const issue=(owner?:string,download=false)=>fetch(base+'/api/media-playback',{method:'POST',headers:{'content-type':'application/json',...(owner?{'x-owner':owner}:{})},body:JSON.stringify({type:'artifact',id:'video',download})});
 assert.equal((await issue()).status,401);assert.equal((await issue('b')).status,404);const granted=await issue('a');assert.equal(granted.status,200);const url=base+(await granted.json()).url;assert.equal(prepared,0,'Issuing playback does not first download the entire movie');
 const range=await fetch(url,{headers:{Range:'bytes=0-7'}});assert.equal(range.status,206);assert.equal(await range.text(),'abcdefgh');assert.equal(range.headers.get('content-range'),'bytes 0-7/'+210*1024*1024);assert.match(range.headers.get('cache-control')!,/private.*no-store/);assert.equal(range.headers.get('content-type'),'video/mp4');
 const head=await fetch(url,{method:'HEAD'});assert.equal(head.status,200);assert.equal(head.headers.get('content-length'),String(210*1024*1024));assert.equal((await fetch(url,{method:'POST'})).status,405);
 const download=await issue('a',true),downloadUrl=base+(await download.json()).url;assert.match((await fetch(downloadUrl,{method:'HEAD'})).headers.get('content-disposition')!,/^attachment/);
 present=false;assert.equal((await fetch(url)).status,410);present=true;now=31*60000;assert.equal((await fetch(url)).status,404);assert.equal((await fetch(url+'tampered')).status,404);
});

test('oversize native originals offer a scoped browser download instead of a guaranteed failed WeChat save',async()=>{
 let copied='',downloadRequests=0;const item={id:'large',name:'高清整片',kind:'video',url:'/private',sizeBytes:350*1024*1024},app:any={_generation:1,state:{media:[],artifacts:[item],jobs:[]},subscribe:()=>()=>{},refresh:async()=>{},client:{hasSession:()=>true,previewUrl:()=>'',mediaUrl:(s:string)=>'https://example.test'+s,request:async(_route:string,b:any)=>{if(b.download)downloadRequests++;return {url:b.download?'/api/media-playback/download':'/api/media-playback/play'};},download:async()=>{throw Error('Must not download oversize video through WeChat');}}};
 const page=await capturePage('player',app,{showModal:(o:any)=>o.success({confirm:true}),setClipboardData:(o:any)=>{copied=o.data;o.success();}});page.onLoad({type:'artifact',id:'large'});page.onShow();await waitFor(()=>Boolean(page.data.src));assert.equal(page.data.item.largeVideo,true);await page.save();assert.equal(downloadRequests,1);assert.equal(copied,'https://example.test/api/media-playback/download');assert.equal(page.data.error,'');page.onHide();
});

test('native long-video player requests scoped playback instead of downloading the full file first',async()=>{
 const calls:any[]=[],state:any={media:[],artifacts:[{id:'v',name:'整片',kind:'video',duration:250,createdAt:'2026-11-21',url:'/private-v'}],jobs:[]};
 const app:any={_generation:1,state,subscribe:()=>()=>{},refresh:async()=>{},client:{hasSession:()=>true,previewUrl:()=>'',request:async(route:string,body:any)=>{calls.push({route,body});return {url:'/api/media-playback/scoped'};},mediaUrl:(url:string)=>'https://example.test'+url,download:async()=>{throw Error('Must not download a complete long movie for playback');}}};
 const page=await capturePage('player',app,{});page.onLoad({type:'artifact',id:'v'});page.onShow();await waitFor(()=>Boolean(page.data.src));assert.equal(page.data.src,'https://example.test/api/media-playback/scoped');assert.deepEqual(JSON.parse(JSON.stringify(calls)),[{route:'/api/media-playback',body:{type:'artifact',id:'v'}}]);page.onHide();
});
