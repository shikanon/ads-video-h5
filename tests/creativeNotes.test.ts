import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {mountCreativeNotes,noteInput} from '../server/creativeNoteRoutes';
import {capturePage} from './fixtures/nativeClient';
import {startCreditServer} from './fixtures/creditServer';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
test('creative notes validate drawing data, isolate accounts, preserve revisions and link owned projects',async t=>{
 const state:any={creativeNotes:[],media:[{id:'image',ownerId:'a',kind:'image'}],artifacts:[{id:'work',ownerId:'a',name:'作品',mediaId:'image'}],sessions:[{id:'s',ownerId:'a'}]},app=express();app.use(express.json(),(q,_r,next)=>{(q as any).user={id:q.get('x-owner')||'a'};next();});let saves=0;mountCreativeNotes(app,{state:()=>state,save:async()=>{saves++;}});
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));t.after(()=>new Promise<void>(r=>{server.closeAllConnections();server.close(()=>r());}));const base='http://127.0.0.1:'+(server.address() as any).port;
 const call=(route:string,body?:unknown,method='POST',owner='a')=>fetch(base+route,{method,headers:{'content-type':'application/json','x-owner':owner},body:body===undefined?undefined:JSON.stringify(body)}),body={title:'灵感',text:'保留原意',kind:'note',attachmentIds:['image'],strokes:[[{x:.1,y:.2},{x:.5,y:.8}]]};
 assert.throws(()=>noteInput({...body,strokes:[[{x:NaN,y:0}]]},state.media,'a'));assert.throws(()=>noteInput({...body,attachmentIds:['missing']},state.media,'a'));
 const made:any=await(await call('/api/creative-notes',body)).json(),id=made.note.id;assert.equal(made.note.revision,1);assert.equal((await call('/api/creative-notes/'+id,{...body,revision:1},'PATCH','b')).status,404);assert.equal((await(await call('/api/creative-notes',undefined,'GET','b')).json() as any).notes.length,0);
 assert.equal((await call('/api/creative-notes/'+id,{...body,sessionId:'s',revision:1},'PATCH')).status,200);assert.equal((await call('/api/creative-notes/'+id,{...body,revision:1},'PATCH')).status,409);
 const draft:any=await(await call('/api/artifacts/work/template-draft',{})).json();assert.equal(draft.note.kind,'template');assert.deepEqual(draft.note.attachmentIds,['image']);assert.equal((await(await call('/api/artifacts/work/template-draft',{})).json() as any).note.id,draft.note.id);assert.equal((await call('/api/artifacts/work/template-draft',{},'POST','b')).status,404);
 assert.equal((await call('/api/media/image/creative-asset',{role:'character',identity:'蓝色外套'},'PATCH')).status,200);assert.equal(state.media[0].creativeAsset.role,'character');assert.equal((await call('/api/media/image/creative-asset',{role:null,identity:''},'PATCH')).status,200);assert.equal(state.media[0].creativeAsset,undefined);
 assert.equal((await call('/api/creative-notes/'+id,undefined,'DELETE')).status,200);assert.equal(state.media.length,1);assert.ok(saves>=5);
});
test('real service persists notes and returns the owning project link without exposing it to another account',{timeout:60000},async t=>{
 const f=await startCreditServer();t.after(()=>f.close());const cookie=await f.login(),other=await f.login('shikanon@example.test');const response=await f.request(cookie,'/api/creative-notes',{title:'MV草稿',text:'按真实音频规划',kind:'mv',attachmentIds:[],strokes:[],sessionId:'ordinary-session'});assert.equal(response.status,201);const result:any=await response.json();const disk=JSON.parse(await readFile(path.join(f.directory,'app-state.json'),'utf8'));assert.equal(disk.creativeNotes[0].id,result.note.id);const own:any=await(await f.request(cookie,'/api/state')).json(),foreign:any=await(await f.request(other,'/api/state')).json();assert.equal(own.creativeNoteLinks[0].id,result.note.id);assert.equal(foreign.creativeNoteLinks.length,0);assert.equal((await f.request(other,'/api/creative-notes/'+result.note.id,undefined,'DELETE')).status,404);
});
test('MV cannot dispatch without recognized audio, note editing restores project link and logout clears drafts',async()=>{
 const calls:any[]=[],state:any={media:[],sessions:[],artifacts:[],jobs:[],models:[],settings:{}},app:any={_generation:1,state,client:{hasSession:()=>true,previewUrl:()=>'',request:async()=>({notes:[]})},subscribe:()=>()=>{},refresh:async()=>state};
 const wx:any={showToast:(o:any)=>calls.push(o),showModal:(o:any)=>o.success({confirm:true}),showShareMenu(){}};
 const page=await capturePage('creative-studio',app,wx);page.onLoad({mode:'mv'});page.onShow();page.setData({text:'MV想法'});await page.agent();assert.match(calls[0].title,/完成识别/);page.setData({notes:[{id:'n',title:'笔记',text:'内容',revision:1,attachmentIds:[],strokes:[],sessionId:'s'}]});await page.openNote({currentTarget:{dataset:{id:'n'}}});assert.equal(page.data.sessionId,'s');app._generation++;page.onShow();assert.equal(page.data.text,'');assert.equal(page.data.sessionId,'');page.onHide();
});
test('hand drawing stores local normalized points instead of screen coordinates',async()=>{
 const app:any={_generation:1,client:{hasSession:()=>false}},wx:any={createCanvasContext:()=>({setStrokeStyle(){},setLineWidth(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},draw(){}})},p=await capturePage('creative-studio',app,wx);p.onLoad({});p._drawRect={left:16,top:100};p.drawStart({touches:[{clientX:46,clientY:140}]});p.drawMove({touches:[{clientX:166,clientY:200}]});p.drawEnd();assert.equal(p.data.strokes[0][0].x,.1);assert.equal(p.data.strokes[0][0].y,.2);assert.equal(p.data.strokes[0][1].x,.5);assert.equal(p.data.strokes[0][1].y,.5);
});
