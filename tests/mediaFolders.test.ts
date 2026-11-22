import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {mountMediaFolders,mvFolderSelection} from '../server/mediaFolders';
import {mountMvRecreation} from '../server/mvRecreationRoutes';
import {capturePage,waitFor} from './fixtures/nativeClient';

test('owned material folders close CRUD, preserve media on delete and resolve one-line MV input without cross-account guessing',async t=>{
 const media:any[]=[{id:'ref',ownerId:'a',kind:'video',duration:2},{id:'audio',ownerId:'a',kind:'audio',duration:2},{id:'source',ownerId:'a',kind:'video',duration:2},{id:'other',ownerId:'b',kind:'video',duration:2}],state:any={media,jobs:[],mvRecreations:[]},app=express();
 app.use(express.json(),(q,_r,next)=>{(q as any).user={id:q.get('x-owner')||'a'};next();});const snapshot=async(u:any)=>({media:state.media.filter((m:any)=>m.ownerId===u.id),mediaFolders:(state.mediaFolders||[]).filter((f:any)=>f.ownerId===u.id)});
 const options={state:()=>state,save:async()=>{},snapshot};mountMediaFolders(app,options);mountMvRecreation(app,{...options,kick(){},session:async()=> 's',start:async()=>{throw Error('Creation must not charge or render without explicit dispatch');}});
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));t.after(()=>new Promise<void>(r=>{server.closeAllConnections();server.close(()=>r());}));const base='http://127.0.0.1:'+(server.address() as any).port;
 const call=(route:string,body?:any,method='POST',owner='a')=>fetch(base+route,{method,headers:{'content-type':'application/json','x-owner':owner},body:body===undefined?undefined:JSON.stringify(body)});
 const created=await call('/api/media-folders',{name:'画中归人'});assert.equal(created.status,201);const folder=(await created.json()).mediaFolders[0];
 const duplicate=await Promise.all([call('/api/media-folders',{name:'画中归人'}),call('/api/media-folders',{name:'画中归人'})]);assert.ok(duplicate.every(r=>r.status===400));
 assert.equal((await call('/api/media-folders/assign',{folderId:folder.id,mediaIds:['source','other']})).status,400);assert.ok(state.media.every((m:any)=>!m.folderId),'No partial cross-account moves');
 assert.equal((await call('/api/media-folders/assign',{folderId:folder.id,mediaIds:['source','ref','audio']})).status,200);
 assert.throws(()=>mvFolderSelection(state,'a',folder.id,'做MV'),/参考片/);
 assert.equal((await call('/api/media-folders/'+folder.id,{mv:{referenceId:'ref',audioId:'audio'}},'PATCH')).status,200);
 assert.deepEqual(mvFolderSelection(state,'a',undefined,'用画中归人文件夹做一支MV').sourceIds,['source']);assert.throws(()=>mvFolderSelection(state,'b',folder.id,'画中归人'),/选择/);
 const body={folderId:folder.id,prompt:'用画中归人文件夹做MV',requestId:'folder_same_request_123'};
 const made=await Promise.all([call('/api/mv-recreations/from-folder',body),call('/api/mv-recreations/from-folder',body)]);assert.ok(made.every(r=>r.ok));assert.equal(state.mvRecreations.length,1);assert.deepEqual(state.mvRecreations[0].sourceIds,['source']);assert.equal(state.jobs.length,0);
 assert.equal((await call('/api/mv-recreations/from-folder',{...body,prompt:'改了要求'})).status,409);
 assert.equal((await call('/api/media-folders/'+folder.id,{name:'归人素材'},'PATCH','b')).status,404);assert.equal((await call('/api/media-folders/'+folder.id,{name:'归人素材'},'PATCH')).status,200);
 assert.equal((await call('/api/media-folders/'+folder.id,undefined,'DELETE')).status,200);assert.equal(state.media.length,4);assert.ok(state.media.every((m:any)=>!m.folderId));assert.equal(state.mvRecreations.length,1,'Deleting organizational folder preserves existing project');
});

test('native resource folders filter the same project, allow bulk moving and clear folder selection on account change',async()=>{
 const state:any={mediaFolders:[{id:'f',name:'画中归人'}],media:[{id:'one',folderId:'f',name:'镜头',kind:'video',createdAt:'2026-11-21',origin:'upload'},{id:'two',name:'根素材',kind:'image',createdAt:'2026-11-21',origin:'upload'}],jobs:[],artifacts:[],features:{}},calls:any[]=[],app:any={_generation:1,state,client:{hasSession:()=>true,previewUrl:()=>'',download:async()=>'',assetURL:(u:string)=>u},subscribe:()=>()=>{},refresh:async()=>{},mutate:async(...args:any[])=>calls.push(args)};
 const page=await capturePage('library',app,{});page.onLoad();page.onShow();page.folder({currentTarget:{dataset:{id:'f'}}});assert.deepEqual(Array.from(page.data.items,(m:any)=>m.id),['one']);
 page.organize();page.play({currentTarget:{dataset:{id:'one'}}});assert.equal(page.data.items[0].selected,true);
 await page.assignFolder({currentTarget:{dataset:{id:''}}});assert.deepEqual(JSON.parse(JSON.stringify(calls[0])),['/api/media-folders/assign',{folderId:null,mediaIds:['one']}]);
 assert.equal(page.data.items[0].selected,false);
 app._generation++;state.media=[];state.mediaFolders=[];page.onShow();assert.equal(page.data.folderId,'all');assert.equal(page.data.selectedIds.length,0);page.onHide();
});

test('native one-line folder MV request persists project then dispatches real planning, preserving idempotency',async()=>{
 const calls:any[]=[],project={id:'mv',name:'画中归人 MV',sourceIds:['source'],duration:2},state:any={mediaFolders:[{id:'f',name:'画中归人'}],media:[],jobs:[]};const app:any={_generation:1,state,client:{hasSession:()=>true,request:async(url:string,body:any)=>{calls.push({url,body});return url==='/api/mv-recreations'?{projects:[project]}:{project,state};}},apply(){},subscribe:()=>()=>{},refresh:async()=>{}};
 const page=await capturePage('mv-recreate',app,{showModal:(o:any)=>o.success({confirm:true})});page.onLoad({folderId:'f'});page.onShow();await waitFor(()=>calls.some(c=>c.url==='/api/mv-recreations'));await page.makeFromFolder();const create=calls.find(c=>c.url==='/api/mv-recreations/from-folder'),dispatch=calls.find(c=>c.url==='/api/mv-recreations/mv/plan');assert.equal(create.body.folderId,'f');assert.match(create.body.prompt,/画中归人/);assert.equal(dispatch.body.requestId,create.body.requestId);page.onHide();
});
