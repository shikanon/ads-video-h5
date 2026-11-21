import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,copyFile,access} from 'node:fs/promises';
import path from 'node:path';
import {startCreditServer} from './fixtures/creditServer';
import {runFFmpeg,probeVideo} from '../server/core';
import {capturePage,waitFor,miniRequire} from './fixtures/nativeClient';

test('real service executes the MV queue, persists a plan and publishes a rendered artifact reachable from its project',{timeout:90000},async t=>{
 const f=await startCreditServer({structuredReply:body=>{
  const input=JSON.parse(body.messages[1].content[0].text);
  if(input.sources)return {story:'原片叙事',shots:[{sourceId:input.sources[0].id,start:0,duration:2,chapter:'重逢',reason:'使用已抽帧的原录屏',transition:'cut'}],captions:[],limitations:['受控供应商回复，仅验证执行链路']};
  return {description:'实际受控红色画面；稀疏抽帧未验证完整动作。'};
 },prepare:async dir=>{
  await mkdir(path.join(dir,'media'),{recursive:true});
  await runFFmpeg(['-v','error','-y','-f','lavfi','-i','color=c=red:s=160x90:d=2:r=30','-c:v','libx264','-threads','1','-pix_fmt','yuv420p','-f','mp4',path.join(dir,'media','video-fixture')]);
  await copyFile(path.join(dir,'media','video-fixture'),path.join(dir,'media','original-source'));
  await runFFmpeg(['-v','error','-y','-f','lavfi','-i','sine=frequency=440:duration=2','-c:a','pcm_s16le','-f','wav',path.join(dir,'media','music-source')]);
  const file=path.join(dir,'app-state.json'),state=JSON.parse(await readFile(file,'utf8'));state.media[0].duration=2;state.media.push({id:'original-source',ownerId:'ordinary',name:'原录屏',kind:'video',duration:2,mimeType:'video/mp4'},{id:'music-source',ownerId:'ordinary',name:'原音乐',kind:'audio',duration:2,mimeType:'audio/wav'});for(const m of state.media){m.url||='/api/media/'+m.id;m.createdAt||=new Date().toISOString();}await writeFile(file,JSON.stringify(state));
 }});t.after(()=>f.close());const cookie=await f.login(),other=await f.login('shikanon@example.test');
 const created=await f.request(cookie,'/api/mv-recreations',{name:'MV执行测试',referenceId:'video-fixture',audioId:'music-source',sourceIds:['original-source'],instructions:'只剪原录屏，不生成角色'});assert.equal(created.status,201,await created.clone().text());const p=(await created.json() as any).project;
 const terminal=async()=>{let state:any,job:any;for(let i=0;i<300;i++){state=await(await f.request(cookie,'/api/state')).json();job=state.jobs.slice().reverse().find((j:any)=>j.mvTask?.projectId===p.id);if(job&&['failed','succeeded','cancelled'].includes(job.status))break;await new Promise(r=>setTimeout(r,100));}assert.equal(job?.status,'succeeded',JSON.stringify(job));return {state,job};};
 assert.equal((await f.request(cookie,'/api/mv-recreations/'+p.id+'/plan',{requestId:'mv_plan_http_0001'})).status,202);await terminal();
 const planned=(await(await f.request(cookie,'/api/mv-recreations')).json() as any).projects[0];assert.equal(planned.plan.shots[0].sourceId,'original-source');
 const preview=await f.request(cookie,'/api/mv-recreations/'+p.id+'/preview',{requestId:'mv_preview_http_01',planHash:planned.planHash});assert.equal(preview.status,202);const rendered=await terminal(),artifact=rendered.state.artifacts.find((a:any)=>a.id===rendered.job.artifactId);assert.ok(artifact);assert.equal(artifact.kind,'video');
 const bytes=await f.request(cookie,'/api/artifacts/'+artifact.id);assert.equal(bytes.status,200);const video=path.join(f.directory,'downloaded.mp4');await writeFile(video,Buffer.from(await bytes.arrayBuffer()));assert.equal((await probeVideo(video)).hasAudio,true);
 assert.equal((await f.request(other,'/api/mv-recreations/'+p.id+'/preview',{requestId:'mv_foreign_http01',planHash:planned.planHash})).status,404);
 const disk=JSON.parse(await readFile(path.join(f.directory,'app-state.json'),'utf8'));assert.equal(disk.mvRecreations[0].previewArtifactId,artifact.id);
 const cache=path.join(f.directory,'mv-recreations',p.id);await access(cache);assert.equal((await f.request(cookie,'/api/mv-recreations/'+p.id,undefined,'DELETE')).status,200);await assert.rejects(()=>access(cache));assert.equal((await f.request(cookie,'/api/artifacts/'+artifact.id)).status,200);
});

test('native MV page restores the plan, lists ordered nodes, renames projects and clears account drafts',async()=>{
 const calls:any[]=[],p:any={id:'p',name:'MV',duration:250,sourceIds:['source'],plan:{story:'旧约到重逢',shots:[{sourceId:'source',start:1,duration:5,chapter:'旧约'}],limitations:[]},nodeArtifacts:{10:'eleven',2:'three'}};
 const app:any={_generation:1,state:{media:[{id:'source',name:'原录屏'}],jobs:[]},client:{hasSession:()=>true,request:async(url:string,body:any,method:string)=>{calls.push({url,body,method});return {projects:[p]};}},subscribe:()=>()=>{},refresh:async()=>{}};
 const wx:any={showModal:(o:any)=>o.success({confirm:true,content:'新MV名称'}),showToast(){}};const page=await capturePage('mv-recreate',app,wx);page.onLoad({projectId:'p'});page.onShow();await waitFor(()=>Boolean(page.data.project));assert.equal(page.data.shots[0].name,'原录屏');assert.deepEqual(Array.from(page.data.nodes,(n:any)=>n.index),[3,11]);await page.rename();assert.equal(calls.find(c=>c.method==='PATCH').body.name,'新MV名称');page.setData({name:'私人项目名',instructions:'私人创作要求'});app._generation++;page.onShow();assert.equal(page.data.project,null);assert.equal(page.data.planText,'');assert.equal(page.data.sourceCount,0);assert.notEqual(page.data.name,'私人项目名');assert.notEqual(page.data.instructions,'私人创作要求');page.onHide();
});

test('MV chat keeps the project and requested movies visible without listing every internal node',()=>{
 const {projectLinks}=miniRequire('./miniprogram/utils/project-links.js');
 const message={id:'m',artifactIds:['full','preview']},job={sessionId:'s',messageId:'m',artifactId:'full',mvTask:{projectId:'p'}};
 const artifacts=Array.from({length:35},(_,i)=>({id:'node-'+i,kind:'video',sessionId:'s',messageId:'m'})).concat([{id:'full',kind:'video',sessionId:'s',messageId:'m'},{id:'preview',kind:'video',sessionId:'s',messageId:'m'}]);
 assert.deepEqual(projectLinks(message,job,{artifacts}).map((l:any)=>l.id),['mv-p','full','preview']);
});
