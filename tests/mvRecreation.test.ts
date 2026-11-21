import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import express from 'express';
import {validateMvPlan,fitMvTiming,mvPlanHash,renderMv} from '../server/mvRecreation';
import {mountMvRecreation} from '../server/mvRecreationRoutes';
import {runFFmpeg,probeVideo} from '../server/core';
import {fileDigest} from '../server/artifactIntegrity';
function fixture(){const media:any[]=[{id:'ref',ownerId:'a',kind:'video',name:'参考',duration:2,hasAudio:true},{id:'song',ownerId:'a',kind:'audio',name:'配乐',duration:2},{id:'red',ownerId:'a',kind:'video',duration:2},{id:'blue',ownerId:'a',kind:'video',duration:2}];const project:any={id:'p',ownerId:'a',sessionId:'s',name:'复刻',referenceId:'ref',audioId:'song',sourceIds:['red','blue'],duration:2,instructions:'只剪原素材'};const plan:any={story:'旧约到重逢',shots:[{sourceId:'red',start:0,duration:1,chapter:'旧约',reason:'真实红色镜头',transition:'cut'},{sourceId:'blue',start:0,duration:1.2,chapter:'重逢',reason:'真实蓝色镜头',transition:'fade'}],captions:[],limitations:['技术夹具，不是视觉质量证明']};return {media,project,plan};}
test('MV plans enforce ownership, original ranges, exact audio duration and exclude the reference as output',()=>{
 const {media,project,plan}=fixture();assert.equal(validateMvPlan(plan,project,media).shots.length,2);
 for(const changed of [{...plan,shots:[{...plan.shots[0],sourceId:'ref'},plan.shots[1]]},{...plan,shots:[{...plan.shots[0],duration:3},plan.shots[1]]},{...plan,shots:[{...plan.shots[0],start:-1},plan.shots[1]]},{...plan,captions:[{start:0,end:8,text:'超时'}]}])assert.throws(()=>validateMvPlan(changed,project,media));
 assert.throws(()=>validateMvPlan(plan,project,media.map(m=>({...m,ownerId:'b'}))));
 assert.throws(()=>validateMvPlan({...plan,shots:[{...plan.shots[0],duration:.2},{...plan.shots[1],duration:2}]},project,media),/叠化/);
});
test('pre-approval timing fitting uses source headroom and frame boundaries, never loops or changes an approved plan',()=>{
 const {media,project,plan}=fixture();const unchanged=structuredClone(plan),p={...project,duration:2.1};
 const fitted=fitMvTiming(plan,p,media);assert.equal(Math.round(fitted.shots.reduce((sum,s,i)=>sum+s.duration-(i&&s.transition==='fade'?.2:0),0)*30),63);assert.deepEqual(plan,unchanged);assert.ok(fitted.limitations.some(s=>s.includes('没有变速或循环')));assert.equal(validateMvPlan(fitted,p,media).shots.length,2);
 assert.throws(()=>fitMvTiming(plan,{...p,duration:3},media),/时长/);
 assert.throws(()=>fitMvTiming(plan,p,media.map(m=>m.id==='red'?{...m,duration:.5}:m)),/超出/);
});
test('real segmented FFmpeg rendering resumes verified nodes and merges continuous music into a decoded movie',{timeout:120000},async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'mv-recreate-'));t.after(()=>rm(dir,{recursive:true,force:true}));const {media,project,plan}=fixture();
 for(const [id,color]of [['red','red'],['blue','blue'],['ref','green']])await runFFmpeg(['-v','error','-y','-f','lavfi','-i',`color=c=${color}:s=160x90:d=2:r=30`,'-c:v','libx264','-threads','1','-pix_fmt','yuv420p',path.join(dir,id+'.mp4')]);
 await runFFmpeg(['-v','error','-y','-f','lavfi','-i','sine=frequency=440:duration=2','-c:a','pcm_s16le',path.join(dir,'song.wav')]);
 const file=async(id:string)=>path.join(dir,id+(id==='song'?'.wav':'.mp4'));project.plan=plan;project.planHash=mvPlanHash(plan);project.approvedHash=project.planHash;project.evidence={};for(const m of media)project.evidence[m.id]={sha256:await fileDigest(await file(m.id)),description:'real fixture'};
 let fail=true,mtime=0;const published=new Set<number>();const options={project,media,file,directory:dir,preview:false,dimensions:[160,90] as [number,number],progress:async()=>{},onNode:async(i:number,f:string)=>{if(i===0&&!mtime)mtime=(await stat(f)).mtimeMs;if(i===1&&fail){fail=false;throw Error('controlled interruption');}published.add(i);}};
 await assert.rejects(()=>renderMv(options),/controlled interruption/);const result=await renderMv(options);assert.equal(result.receipt.technicalPassed,true);assert.equal(result.receipt.userAccepted,false);assert.equal(result.receipt.duration,2);assert.deepEqual([...published],[0,1]);const cached=path.join(dir,'render-v2-'+project.planHash+'-full-160x90','clip-0.mp4');assert.equal((await stat(cached)).mtimeMs,mtime);assert.equal((await probeVideo(result.file)).hasAudio,true);
 project.approvedHash='old';await assert.rejects(()=>renderMv(options),/确认/);
});
test('MV routes serialize duplicate dispatch, reject stale approval and keep projects private',async t=>{
 const {media,project,plan}=fixture(),state:any={media,mvRecreations:[],jobs:[]},app=express();app.use(express.json(),(q,_r,next)=>{(q as any).user={id:q.get('x-owner')||'a'};next();});let starts=0;
 mountMvRecreation(app,{state:()=>state,save:async()=>{},snapshot:async()=>({jobs:state.jobs}),kick(){},session:async()=> 's',start:async(u,p,phase)=>{starts++;await new Promise(r=>setTimeout(r,20));state.jobs.push({id:'j'+starts,ownerId:u.id,status:'queued',mvTask:{projectId:p.id,phase}});}});
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));t.after(()=>new Promise<void>(r=>{server.closeAllConnections();server.close(()=>r());}));const base='http://127.0.0.1:'+(server.address() as any).port;
 const call=(route:string,body?:unknown,method='POST',owner='a')=>fetch(base+route,{method,headers:{'content-type':'application/json','x-owner':owner},body:body===undefined?undefined:JSON.stringify(body)});
 assert.equal((await call('/api/mv-recreations',{name:'复刻',referenceId:'ref',audioId:'song',sourceIds:['ref'],instructions:''})).status,400);
 const created:any=await(await call('/api/mv-recreations',{name:'复刻',referenceId:'ref',audioId:'song',sourceIds:['red','blue'],instructions:''})).json(),id=created.project.id,p=state.mvRecreations[0];assert.equal((await(await call('/api/mv-recreations',undefined,'GET','b')).json() as any).projects.length,0);
 const start={requestId:'mv_test_request_001'};const rs=await Promise.all([call('/api/mv-recreations/'+id+'/plan',start),call('/api/mv-recreations/'+id+'/plan',start)]);assert.ok(rs.every(r=>r.ok));assert.equal(starts,1);state.jobs[0].status='succeeded';p.plan=plan;p.planHash=mvPlanHash(plan);
 assert.equal((await call('/api/mv-recreations/'+id+'/preview',{requestId:'mv_test_request_002',planHash:'stale'})).status,409);assert.equal((await call('/api/mv-recreations/'+id+'/render',{requestId:'mv_test_request_003',planHash:p.planHash})).status,409);assert.equal((await call('/api/mv-recreations/'+id,undefined,'DELETE','b')).status,404);
 assert.equal((await call('/api/mv-recreations/'+id+'/preview',{requestId:'mv_test_request_004',planHash:p.planHash})).status,202);state.jobs.at(-1).status='succeeded';const oldHash=p.planHash;p.plan={...plan,story:'修改后的叙事'};p.planHash=mvPlanHash(p.plan);
 assert.equal((await call('/api/mv-recreations/'+id+'/preview',{requestId:'mv_test_request_004',planHash:oldHash})).status,409);
 assert.equal((await call('/api/mv-recreations/'+id,undefined,'DELETE')).status,200);
});

test('250 second original-media MV actually renders beyond the short-editor limit with photos, captions and music',{timeout:120000},async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'mv-long-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 await runFFmpeg(['-v','error','-y','-f','lavfi','-i','color=c=red:s=160x90:d=25:r=30','-c:v','libx264','-threads','1','-pix_fmt','yuv420p',path.join(dir,'source.mp4')]);
 await runFFmpeg(['-v','error','-y','-i',path.join(dir,'source.mp4'),'-frames:v','1',path.join(dir,'photo.png')]);
 await runFFmpeg(['-v','error','-y','-f','lavfi','-i','sine=frequency=440:duration=250:sample_rate=22050','-c:a','pcm_s16le',path.join(dir,'song.wav')]);
 const media:any[]=[{id:'source',ownerId:'a',kind:'video',duration:25},{id:'photo',ownerId:'a',kind:'image'},{id:'ref',ownerId:'a',kind:'video',duration:250},{id:'song',ownerId:'a',kind:'audio',duration:250}];
 const file=async(id:string)=>path.join(dir,id==='song'?'song.wav':id==='photo'?'photo.png':'source.mp4');
 const plan:any={story:'Long duration execution fixture',shots:Array.from({length:10},(_,i)=>({sourceId:i===1?'photo':'source',start:0,duration:25,chapter:'Chapter '+i,reason:'Fixture node',transition:'cut'})),captions:[{start:0,end:3,text:'技术验证'}],limitations:['Synthetic fixture; not a visual recreation acceptance']};
 const project:any={id:'long',ownerId:'a',referenceId:'ref',audioId:'song',sourceIds:['source','photo'],duration:250,plan,planHash:mvPlanHash(plan),evidence:{}};project.approvedHash=project.planHash;for(const m of media)project.evidence[m.id]={sha256:await fileDigest(await file(m.id)),description:'fixture'};
 const nodes:number[]=[];const result=await renderMv({project,media,file,directory:dir,preview:false,dimensions:[160,90],progress:async()=>{},onNode:async i=>{nodes.push(i);}});assert.equal(nodes.length,10);assert.equal(result.receipt.duration,250);assert.equal((await probeVideo(result.file)).hasAudio,true);
 // Metadata alone cannot allow a truncated actual soundtrack.
 await runFFmpeg(['-v','error','-y','-f','lavfi','-i','sine=duration=1','-c:a','pcm_s16le',path.join(dir,'song.wav')]);project.evidence.song.sha256=await fileDigest(await file('song'));await assert.rejects(()=>renderMv({project,media,file,directory:dir,preview:false,dimensions:[160,90],progress:async()=>{}}),/配乐时长不足/);
});
