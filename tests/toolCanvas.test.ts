import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import express from 'express';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {capturePage,waitFor} from './fixtures/nativeClient';
import {startCreditServer} from './fixtures/creditServer';
import {mountToolBatchRoutes,batchViews} from '../server/toolBatchRoutes';
import {validateWorkspace} from '../server/lifecycleRoutes';
const require=createRequire(import.meta.url);
const {worldPoint,screenPoint,visibleNodes}=require('../apps/miniprogram/miniprogram/utils/infinite-canvas.js');
const {nodeViews,projectRows}=require('../apps/miniprogram/miniprogram/utils/tool-workbench.js');
const e=(id:string)=>({currentTarget:{dataset:{id}}});
const touches=(points:number[][],id?:string)=>({touches:points.map(([clientX,clientY])=>({clientX,clientY})),currentTarget:{dataset:{id}}});
async function canvas(){
 const state:any={account:{id:'a'},sessions:[],jobs:[],media:[],artifacts:[],models:[],settings:{},credits:{balance:1000}};
 const calls:any[]=[],app:any={state,user:{id:'a'},_generation:1,subscribe:()=>()=>{},refresh:async()=>state,client:{hasSession:()=>false,previewUrl:()=>'',download:async()=>'/private.png'}};
 const wx:any={getWindowInfo:()=>({windowWidth:390,windowHeight:680}),showShareMenu(){},getStorageSync(){},setStorageSync(){},navigateTo:(v:any)=>calls.push(v)};
 const page=await capturePage('templates',app,wx);page.onLoad();page.onShow();page._boardRect={left:51,top:75,width:339,height:360};return {page,state,app,wx,calls};
}
test('world coordinates pan into negative space, pinch around a fixed anchor, and tap selects a generation origin',async()=>{
 const {page}=await canvas();page.setData({camera:{x:-10000,y:8000,zoom:2}});
 const p={x:180,y:220};assert.deepEqual(screenPoint(page.data.camera,worldPoint(page.data.camera,p)),p);
 page.boardStart(touches([[101,125]]));page.boardEnd(touches([]));assert.equal(page.data.nextPosition.x,-9975);assert.equal(page.data.nextPosition.y,8025);
 page.boardStart(touches([[101,125]]));page.boardMove(touches([[301,325]]));page.boardEnd(touches([]));assert.equal(page.data.camera.x,-10100);assert.equal(page.data.nextPosition.x,-9975,'panning must not move the chosen origin');
 page.setData({camera:{x:0,y:0,zoom:1}});page.boardStart(touches([[151,175],[251,175]]));page.boardMove(touches([[101,175],[301,175]]));assert.equal(page.data.camera.zoom,2);assert.equal(worldPoint(page.data.camera,{x:150,y:100}).x,150);page.boardEnd(touches([]));page.onHide();
});
test('overlapping old outputs are draggable, independently scalable, removable and restorable without deleting source records',async()=>{
 const {page,state}=await canvas();state.artifacts=[{id:'a',name:'旧作品',kind:'image',url:'/a',sessionId:'legacy'},{id:'b',name:'旧视频',kind:'video',url:'/b',sessionId:'legacy'}];state.sessions=[{id:'legacy',messages:[]}];page.setData({category:'video'});page.render(state);
 page._cameraReady=true;page._cameraAuto=false;page.setData({camera:{x:0,y:0,zoom:2}});page.nodeStart(touches([[100,100]],'artifact-a'));page.nodeMove(touches([[-100,-100]],'artifact-a'));page.nodeEnd();const moved=page._worldNodes.find(n=>n.id==='artifact-a');assert.equal(moved.x,-92);assert.equal(moved.y,-92);
 const other=JSON.stringify(page._worldNodes.find(n=>n.id==='artifact-b'));
 page.nodeStart(touches([[100,100],[200,100]],'artifact-a'));page.nodeMove(touches([[50,100],[250,100]],'artifact-a'));page.nodeEnd();assert.equal(page._worldNodes.find(n=>n.id==='artifact-a').scale,2);assert.equal(JSON.stringify(page._worldNodes.find(n=>n.id==='artifact-b')),other);
 const pinned=page._worldNodes.find(n=>n.id==='artifact-a').x;page.removeNode(e('artifact-a'));page.render(state);assert.equal(page.data.nodeCount,1);assert.equal(state.artifacts.length,2);page.undo();assert.equal(page.data.nodeCount,2);assert.equal(page._worldNodes.find(n=>n.id==='artifact-a').x,pinned);
 page.focusNode(e('artifact-a'));assert.ok(page.data.nodes.some(n=>n.id==='artifact-a'));page.onHide();
});
test('virtualization keeps a bounded render set while all distant objects remain addressable',()=>{
 const nodes=Array.from({length:5000},(_,i)=>({id:''+i,x:i*200,y:i*200,width:128,height:168,z:i+1}));
 assert.equal(visibleNodes(nodes,{x:999800,y:999800,zoom:1},339,360).at(-1).id,'4999');assert.ok(visibleNodes(nodes,{x:0,y:0,zoom:.1},339,360).length<30);
 const w:any={version:1,category:'video',templateId:null,draft:'',attachmentIds:[],nodes:[{id:'a',sourceKind:'artifact',sourceId:'old',x:-900000,y:800000,width:128,height:168,scale:.25,z:99}],camera:{x:-999999,y:800000,zoom:.1},nextPosition:{x:-900000,y:800000}};
 assert.equal(validateWorkspace(w).camera?.x,-999999);assert.throws(()=>validateWorkspace({...w,camera:{x:0,y:0,zoom:0}}));assert.throws(()=>validateWorkspace({...w,nextPosition:{x:Infinity,y:0}}));
});
test('legacy artifacts, generated images and sticker samples show without a workspace; frozen job placement overrides grid defaults',()=>{
 const client={previewUrl:()=>''},state:any={sessions:[{id:'old',title:'历史视频'},{id:'sticker',title:'历史表情'}],media:[{id:'m',name:'生成图',origin:'generated',kind:'image',url:'/m'}],artifacts:[{id:'a',sessionId:'old',messageId:'message',name:'成片',kind:'video',url:'/a'}],jobs:[{id:'j',sessionId:'old',messageId:'message',artifactId:'a',toolPlacement:{x:-12000,y:50000}}]};
 const projects=[{id:'p',sessionId:'sticker',styleCandidates:[],completed:[{id:'01',thumbnailUrl:'/thumb',previewUrl:'/preview'}]}];
 const video=nodeViews(null,state,projects,client,'video');assert.equal(video.length,2);assert.equal(video.find(n=>n.sourceId==='a').x,-12000);
 assert.equal(nodeViews(null,state,projects,client,'stickers').length,1);assert.equal(projectRows(state,projects).length,2);
 const blank={id:'blank',toolWorkspace:{category:'video',includeHistory:false,nodes:[],attachmentIds:[]}};assert.equal(nodeViews(blank,state,projects,client,'video').length,0);
});
test('switching accounts clears private batch drafts and cached work drawers',async()=>{
 const {page,app}=await canvas();page.setData({batchText:'private topics',batchName:'private name',works:[{id:'private'}],batches:[{id:'private'}],positionChosen:true});page._batchSubmission={requestId:'old'};app._generation++;page.onShow();assert.equal(page.data.batchText,'');assert.equal(page.data.batchName,'');assert.equal(page.data.works.length,0);assert.equal(page.data.batches.length,0);assert.equal(page._batchSubmission,null);assert.equal(page.data.positionChosen,false);page.onHide();
});
test('batch form only submits after confirmation, preserves its inputs across the material picker, and reuses an uncertain request id',async()=>{
 const {page,app,wx}=await canvas();app.client.hasSession=()=>true;page.openBatch();assert.ok(page.data.batchTemplates.length>=4);page.batchField({currentTarget:{dataset:{field:'batchText'}},detail:{value:'主题一\n主题二'}});page.openSheet(e('materials'));page.closeSheet();assert.equal(page.data.sheet,'batch');assert.equal(page.data.batchCount,2);
 let posts:any[]=[];app.commit=(s:any)=>{app.state=s;};app.client.request=async(route:string,body:any)=>{posts.push({route,body});throw Error('connection lost');};wx.showModal=(o:any)=>o.success({confirm:false});await page.startBatch();assert.equal(posts.length,0);
 wx.showToast=()=>{};wx.showModal=(o:any)=>o.success({confirm:true});await page.startBatch();await page.startBatch();assert.equal(posts.length,2);assert.equal(posts[0].body.requestId,posts[1].body.requestId);assert.equal(posts[0].body.topics.length,2);assert.equal(page.data.batchSending,false);page.onHide();
});
test('batch routes serialize duplicate submissions, expose partial admission and scope management to the owner',async t=>{
 const state:any={toolBatches:[],jobs:[],sessions:[],media:[{id:'m',ownerId:'a'},{id:'foreign',ownerId:'b'}]},app=express();let starts=0,rejectSecond=true;
 app.use(express.json(),(q,_r,next)=>{(q as any).user={id:q.get('x-owner')||'a'};next();});
 mountToolBatchRoutes(app,{state:()=>state,templates:()=>[{id:'video',name:'视频',output:'video'},{id:'sticker',name:'表情',output:'sticker-pack'}],save:async()=>{},snapshot:async u=>({toolBatches:batchViews(state.toolBatches,state.jobs,state.sessions,u.id)}),kick(){},stop:(_u,id)=>{for(const j of state.jobs)if(j.sessionId===id)j.status='cancelled';},start:async(u,b,index)=>{starts++;if(index===1&&rejectSecond)throw Error('积分不足');const sessionId='s'+index,jobId='j'+index;state.sessions.push({id:sessionId,ownerId:u.id,toolBatchId:b.id});state.jobs.push({id:jobId,ownerId:u.id,sessionId,status:'queued'});return {sessionId,jobId};}});
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));t.after(()=>new Promise<void>(r=>{server.closeAllConnections();server.close(()=>r());}));const base='http://127.0.0.1:'+(server.address() as any).port;
 const call=(route:string,body?:unknown,method='POST',owner='a')=>fetch(base+route,{method,headers:{'content-type':'application/json','x-owner':owner},body:body===undefined?undefined:JSON.stringify(body)}),input={requestId:'batch_test_request_01',templateId:'video',topics:['主题一','主题二'],attachmentIds:['m'],position:{x:-10000,y:10000}};
 const responses=await Promise.all([call('/api/tool-batches',input),call('/api/tool-batches',input)]);assert.deepEqual(responses.map(r=>r.status).sort(),[200,202]);assert.equal(starts,2);const id=state.toolBatches[0].id;
 assert.equal((await call('/api/tool-batches',{...input,topics:['变化']})).status,409);assert.equal((await call('/api/tool-batches',{...input,requestId:'other_test_request_01',attachmentIds:['foreign']})).status,400);assert.equal((await call('/api/tool-batches',{...input,templateId:'sticker'})).status,400);
 assert.equal(batchViews(state.toolBatches,state.jobs,state.sessions,'b').length,0);assert.equal((await call('/api/tool-batches/'+id,{name:'攻击'},'PATCH','b')).status,404);assert.equal((await call('/api/tool-batches/'+id,undefined,'DELETE')).status,409);
 assert.equal((await call('/api/tool-batches/'+id,{name:'新名称'},'PATCH')).status,200);rejectSecond=false;await call('/api/tool-batches/'+id+'/resume',{});assert.equal(starts,3);assert.equal(state.jobs.length,2);
 await call('/api/tool-batches/'+id+'/stop',{});assert.ok(state.jobs.every(j=>j.status==='cancelled'));assert.equal((await call('/api/tool-batches/'+id,undefined,'DELETE')).status,200);assert.equal(state.sessions.length,2);assert.ok(state.sessions.every(s=>!s.toolBatchId));
});
test('real HTTP batch submission freezes original templates into separate sessions and preserves the selected origin',{timeout:60000},async t=>{
 const f=await startCreditServer();t.after(()=>f.close());const cookie=await f.login(),other=await f.login('shikanon@example.test');f.providerState.delay=300;
 const input={requestId:'batch_http_request_01',templateId:'video-style-interface',topics:['日程管理产品','照片整理工具'],attachmentIds:[],position:{x:-4200,y:18000}};
 const response=await f.request(cookie,'/api/tool-batches',input);assert.equal(response.status,202,await response.clone().text());const body:any=await response.json(),b=body.state.toolBatches[0];assert.equal(b.items.length,2);assert.equal(new Set(b.items.map(i=>i.sessionId)).size,2);
 for(const [i,item] of b.items.entries()){const session=body.state.sessions.find(s=>s.id===item.sessionId),job=body.state.jobs.find(j=>j.id===item.jobId);assert.equal(session.toolBatchId,b.id);assert.equal(job.template.id,input.templateId);assert.equal(job.toolPlacement.x,input.position.x+i*180);assert.match(session.messages[0].text,/@界面动效/);assert.ok(session.messages[0].text.includes(input.topics[i]));}
 assert.equal((await f.request(cookie,'/api/tool-batches',input)).status,200);const stranger:any=await(await f.request(other,'/api/state')).json();assert.equal(stranger.toolBatches.length,0);
 await f.request(cookie,'/api/tool-batches/'+b.id+'/stop',{});await waitFor(async()=>{const s:any=await(await f.request(cookie,'/api/state')).json();return !s.toolBatches[0].active;},400);
 const stopped:any=await(await f.request(cookie,'/api/state')).json(),item=stopped.toolBatches[0].items.find(i=>i.status==='cancelled');assert.ok(item);assert.equal((await f.request(cookie,'/api/jobs/'+item.jobId+'/retry',{})).status,200);
 await f.request(cookie,'/api/tool-batches/'+b.id+'/stop',{});
});
test('ordinary chat origin validation rejects bad coordinates and records the accepted point',{timeout:60000},async t=>{
 const f=await startCreditServer({prepare:async dir=>{const file=path.join(dir,'app-state.json'),s=JSON.parse(await readFile(file,'utf8'));s.artifacts.push({id:'legacy-output',ownerId:'ordinary',kind:'image',name:'历史图片',url:'/legacy',sessionId:'ordinary-session'});await writeFile(file,JSON.stringify(s));}});t.after(()=>f.close());const cookie=await f.login();
 const bad=await f.request(cookie,'/api/chat',{sessionId:'ordinary-session',message:'你好',position:{x:'wrong',y:1}});assert.equal(bad.status,400);
 const response=await f.request(cookie,'/api/chat',{sessionId:'ordinary-session',message:'你好',position:{x:-50000,y:150000},requestId:'canvas_http_request_01'});assert.equal(response.status,200);const s:any=await response.json();assert.deepEqual(s.jobs.at(-1).toolPlacement,{x:-50000,y:150000});assert.ok(s.artifacts.some(a=>a.id==='legacy-output'));
});
