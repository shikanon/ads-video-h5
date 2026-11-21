import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {mkdtemp,rm,readFile,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {mountLifecycleRoutes,validateWorkspace} from '../server/lifecycleRoutes';
import {createChatSubmissions} from '../server/chatSubmission';
import {createStickerStudio} from '../server/stickerStudio';
import {createStickerShares} from '../server/stickerShares';
import {createScheduledTasks} from '../server/scheduled-tasks';

test('workspace and naming routes enforce ownership and validate all references; deleting results cleans the conversation and canvas',async t=>{
 const state:any={sessions:[{id:'s',ownerId:'a',title:'项目',messages:[{id:'reply',artifactIds:['result']}]}],media:[{id:'input',ownerId:'a',name:'图片'},{id:'foreign',ownerId:'b',name:'他人图片'}],artifacts:[{id:'result',ownerId:'a',sessionId:'s',name:'结果'}],jobs:[]};
 const app=express();app.use(express.json(),(q,_r,next)=>{(q as any).user={id:q.get('x-owner')||'a'};next();});let saved=0;
 mountLifecycleRoutes(app,{state:()=>state,save:async()=>{saved++;},snapshot:async()=>state,stickerOwner:async(o,id)=>{if(o!=='a'||id!=='sticker')throw Object.assign(Error('不存在'),{status:404});}});
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));t.after(()=>new Promise<void>(r=>{server.closeAllConnections();server.close(()=>r());}));const base='http://127.0.0.1:'+(server.address() as any).port;
 const call=(route:string,body?:unknown,method='PATCH',owner='a')=>fetch(base+route,{method,headers:{'content-type':'application/json','x-owner':owner},body:body===undefined?undefined:JSON.stringify(body)});
 assert.equal((await call('/api/sessions/s',{title:'新名称'},'PATCH','b')).status,404);
 assert.equal((await call('/api/sessions/s',{title:'  '})).status,400);assert.equal(saved,0);
 assert.equal((await call('/api/sessions/s',{title:'  新名称  '})).status,200);assert.equal(state.sessions[0].title,'新名称');
 assert.equal((await call('/api/media/input',{name:'角色图'})).status,200);assert.equal((await call('/api/artifacts/result',{name:'成片'})).status,200);
 const w:any={version:1,category:'stickers',templateId:'qingmao-stickers',draft:'制作要求',attachmentIds:['input'],nodes:[{id:'r',sourceId:'result',sourceKind:'artifact',x:0,y:0,width:100,height:150}]};
 assert.equal((await call('/api/sessions/s/workspace',{...w,attachmentIds:['foreign']})).status,409);
 assert.equal((await call('/api/sessions/s/workspace',{...w,nodes:[{...w.nodes[0],sourceId:'missing'}]})).status,409);
 assert.equal((await call('/api/sessions/s/workspace',w)).status,200);assert.equal(state.sessions[0].toolWorkspace.draft,'制作要求');
 state.jobs.push({ownerId:'a',sessionId:'s',status:'running'});assert.equal((await call('/api/artifacts/result',undefined,'DELETE')).status,409);
 state.jobs=[];assert.equal((await call('/api/artifacts/result',undefined,'DELETE','b')).status,404);assert.equal((await call('/api/artifacts/result',undefined,'DELETE')).status,200);
 assert.equal(state.artifacts.length,0);assert.deepEqual(state.sessions[0].messages[0].artifactIds,[]);assert.deepEqual(state.sessions[0].toolWorkspace.nodes,[]);
 for(const invalid of [{...w,category:'other'},{...w,attachmentIds:['input','input']},{...w,nodes:[{...w.nodes[0],x:Infinity}]},{...w,nodes:[{...w.nodes[0],scale:20}]},{...w,nodes:[w.nodes[0],w.nodes[0]]}])assert.throws(()=>validateWorkspace(invalid));
});

test('renaming a paid sticker project preserves its generation identity, deletion closes metadata and direct shared pixels',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'lm-lifecycle-'));t.after(()=>rm(dir,{recursive:true,force:true}));const studio=createStickerStudio(dir),recipe={referenceMediaId:'role',name:'原名称',style:'保留角色',mode:'static' as const};
 const p=await studio.create('a','session','request',recipe,'hash'),other=await studio.create('a','other-session','other-request',recipe,'hash');
 const before=await studio.load('a',p.id);await studio.rename('a',p.id,'新显示名');const after=await studio.load('a',p.id);
 assert.equal(after.recipeHash,before.recipeHash);assert.deepEqual(after.recipe,before.recipe);assert.equal((await studio.view('a',p.id)).recipe.name,'新显示名');assert.equal(after.generationHash,before.generationHash);
 assert.deepEqual((await studio.list('a','session')).map(p=>p.id),[p.id]);assert.ok(other);
 await assert.rejects(()=>studio.rename('b',p.id,'攻击'),/不存在/);
 // Real private files plus content receipts, so public routes exercise deletion revocation.
 const bytes=Buffer.from('private-pixels'),hash=createHash('sha256').update(bytes).digest('hex');
 for(const id of ['01','03','20']){const folder=path.join(studio.folder('a',p.id),'assets','pack',id);await mkdir(folder,{recursive:true});const files:any={};for(const f of ['still.png','thumb.png','atlas.webp']){await writeFile(path.join(folder,f),bytes);files[f]=hash;}await writeFile(path.join(folder,'receipt.json'),JSON.stringify({id,files,modelId:'fixture'}));}
 const shares=createStickerShares(dir,studio),share=await shares.create('a',p.id),app=express();shares.mountPublic(app);const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));t.after(()=>new Promise<void>(r=>{server.closeAllConnections();server.close(()=>r());}));const base='http://127.0.0.1:'+(server.address() as any).port,route='/api/sticker-shares/'+share.token;
 const metadata:any=await(await fetch(base+route)).json();assert.equal((await fetch(base+metadata.share.items[0].previewUrl)).status,200);
 await studio.remove('a',p.id);assert.equal((await fetch(base+route)).status,404);assert.equal((await fetch(base+metadata.share.items[0].previewUrl)).status,404);assert.deepEqual((await studio.list('a')).map(p=>p.id),[other.id]);
 await assert.rejects(()=>studio.create('a','session','request',recipe,'hash'),/已删除/);
 assert.ok((JSON.parse(await readFile(path.join(studio.folder('a',p.id),'project.json'),'utf8'))).deletedAt,'keep the receipt identity for reconciliation; do not resurrect deleted paid work');
});

test('a network retry replays the original chat admission, including concurrent submissions and parameter mismatch',async()=>{
 const submit=createChatSubmissions(),jobs:any[]=[],payload={text:'制作'},id='workbench_request_01';let calls=0;
 const run=async()=>{calls++;await new Promise(r=>setTimeout(r,10));jobs.push({ownerId:'a',sessionId:'s',clientRequestId:id,clientRequestHash:createHash('sha256').update(JSON.stringify(payload)).digest('hex')});return 'created';};
 const values=await Promise.all([submit(jobs,'a','s',id,payload,run,async()=>'replayed'),submit(jobs,'a','s',id,payload,run,async()=>'replayed')]);assert.deepEqual(values,['created','replayed']);assert.equal(calls,1);
 await assert.rejects(()=>submit(jobs,'a','different',id,payload,run,async()=>''),/变化/);
 await assert.rejects(()=>submit(jobs,'a','s',id,{text:'changed'},run,async()=>''),/变化/);
});

test('scheduled tasks can be edited without losing prior runs or crossing account boundaries',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'lm-schedule-edit-'));t.after(()=>rm(dir,{recursive:true,force:true}));const scheduler=await createScheduledTasks(path.join(dir,'tasks.json'),async()=>({sessionId:'s',jobId:'j'}));
 const task=await scheduler.create('a',{title:'旧名',prompt:'旧内容',frequency:'daily',interaction:'chat',nextRunAt:new Date(Date.now()+3600000).toISOString()});
 await assert.rejects(()=>scheduler.edit('b',task.id,{title:'外人'}),/不存在/);await assert.rejects(()=>scheduler.edit('a',task.id,{prompt:''}),/填写/);
 await scheduler.edit('a',task.id,{title:'新名',prompt:'新内容'});assert.equal(scheduler.list('a')[0].title,'新名');assert.deepEqual(scheduler.list('a')[0].runs,task.runs);
});
