import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {writeFile,readFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {PNG} from 'pngjs';
import {startCreditServer} from './fixtures/creditServer';
import {createStickerStudio} from '../server/stickerStudio';

test('real media deletion clears attachments and workspace nodes, refuses another account and removes the private file',async t=>{
 const f=await startCreditServer();t.after(()=>f.close());const cookie=await f.login(),stranger=await f.login('shikanon@example.test'),png=PNG.sync.write(new PNG({width:32,height:32}));
 const form=new FormData();form.append('files',new Blob([new Uint8Array(png)],{type:'image/png'}),'role.png');const uploaded:any=await(await fetch(f.base+'/api/media',{method:'POST',headers:{Cookie:cookie},body:form})).json(),id=uploaded.uploadedMediaIds[0],sessionId=uploaded.activeSessionId;
 const workspace={version:1,category:'stickers',templateId:'qingmao-stickers',draft:'测试',attachmentIds:[id],nodes:[{id:'media-'+id,sourceId:id,sourceKind:'media',x:0,y:0,width:112,height:158}]};
 assert.equal((await f.request(cookie,'/api/sessions/'+sessionId+'/workspace',workspace,'PATCH')).status,200);
 assert.equal((await f.request(stranger,'/api/media/'+id,undefined,'DELETE')).status,404);
 assert.equal((await f.request(cookie,'/api/media/'+id,{name:'新的角色名'},'PATCH')).status,200);
 const removed=await f.request(cookie,'/api/media/'+id,undefined,'DELETE');assert.equal(removed.status,200);const state:any=await removed.json();assert.equal(state.media.some(m=>m.id===id),false);assert.deepEqual(state.sessions.find(s=>s.id===sessionId).toolWorkspace.attachmentIds,[]);assert.deepEqual(state.sessions.find(s=>s.id===sessionId).toolWorkspace.nodes,[]);
 assert.equal((await f.request(cookie,'/api/media/'+id)).status,404);await assert.rejects(()=>readFile(path.join(f.directory,'media',id)));
});

test('an explicitly stopped sticker task resumes with cleared cancellation and reuses its project rather than buying a new project',{timeout:90000},async t=>{
 let projectId='';const png=new PNG({width:128,height:128});for(let y=25;y<105;y++)for(let x=30;x<95;x++){const i=(y*128+x)*4;png.data[i]=190;png.data[i+1]=80;png.data[i+2]=40;png.data[i+3]=255;}const reference=PNG.sync.write(png);
 const f=await startCreditServer({stickerImages:true,prepare:async dir=>{
  const studio=createStickerStudio(dir),p=await studio.create('ordinary','ordinary-session','paused-project',{referenceMediaId:'role',name:'角色',style:'保留角色',mode:'static'},createHash('sha256').update(reference.toString('base64')).digest('hex'));projectId=p.id;
  const file=path.join(dir,'app-state.json'),state=JSON.parse(await readFile(file,'utf8'));Object.assign(state.jobs[0],{status:'cancelled',stopRequestedAt:new Date().toISOString(),cancelledAt:new Date().toISOString(),interaction:'create',template:{id:'qingmao-stickers',skillHash:'prior'},stickerGenerationTask:{projectId:p.id,phase:'samples',makeVideo:false,bgm:false}});
  state.artifacts.push({id:'saved-pack',ownerId:'ordinary',sessionId:'ordinary-session',kind:'sticker-pack',name:'历史套装',url:'/api/artifacts/saved-pack',sticker:{packId:'custom-'+p.id}});state.sessions[0].messages[0].artifactIds=['saved-pack'];state.media.push({id:'role',ownerId:'ordinary',kind:'image',name:'角色图',mimeType:'image/png',url:'/api/media/role'});state.sessions[0].messages[0].attachmentIds=['role'];await mkdir(path.join(dir,'media'),{recursive:true});await writeFile(path.join(dir,'media','role'),reference);await writeFile(file,JSON.stringify(state));
 }});t.after(()=>f.close());const cookie=await f.login(),quote:any=await(await f.request(cookie,'/api/sticker-projects/'+projectId+'/quote?phase=samples')).json();
 const response=await f.request(cookie,'/api/jobs/failed-job/retry',{pricingHash:quote.pricingHash});assert.equal(response.status,200);const started:any=await response.json(),job=started.jobs.find(j=>j.id==='failed-job');assert.equal(job.stopRequestedAt,undefined);assert.equal(job.cancelledAt,undefined);assert.equal(job.stickerGenerationTask.projectId,projectId);
 let finished:any;for(let i=0;i<600;i++){finished=await(await f.request(cookie,'/api/state')).json();if(['succeeded','failed','cancelled'].includes(finished.jobs.find(j=>j.id==='failed-job').status))break;await new Promise(r=>setTimeout(r,100));}assert.equal(finished.jobs.find(j=>j.id==='failed-job').status,'succeeded');const projects:any=await(await f.request(cookie,'/api/sticker-projects')).json();assert.equal(projects.projects.length,1);assert.equal(projects.projects[0].completedCount,3);const balance=finished.credits.balance;assert.equal((await f.request(cookie,'/api/sticker-projects/'+projectId,undefined,'DELETE')).status,200);const removed:any=await(await f.request(cookie,'/api/state')).json();assert.equal(removed.artifacts.some(a=>a.id==='saved-pack'),false);assert.equal(removed.sessions[0].messages.some(m=>(m.artifactIds||[]).includes('saved-pack')),false);assert.equal(removed.credits.balance,balance);assert.equal((await f.request(cookie,'/api/sticker-projects/'+projectId)).status,404);
});

test('an uploaded account avatar can be removed without affecting another account',async t=>{
 const f=await startCreditServer();t.after(()=>f.close());const cookie=await f.login(),other=await f.login('shikanon@example.test'),png=new PNG({width:32,height:32});png.data.fill(255);const form=new FormData();form.append('avatar',new Blob([new Uint8Array(PNG.sync.write(png))],{type:'image/png'}),'avatar.png');
 const uploaded=await fetch(f.base+'/api/account/avatar',{method:'POST',headers:{Cookie:cookie},body:form});assert.equal(uploaded.status,200);const value:any=await uploaded.json(),url=value.user.avatarUrl;assert.ok(url);assert.equal((await f.request(cookie,url)).status,200);
 assert.equal((await f.request(other,'/api/account/avatar',undefined,'DELETE')).status,200);assert.equal((await f.request(cookie,url)).status,200);
 const removed=await f.request(cookie,'/api/account/avatar',undefined,'DELETE');assert.equal(removed.status,200);assert.equal(Boolean((await removed.json() as any).user.avatarUrl),false);assert.equal((await f.request(cookie,url)).status,404);await assert.rejects(()=>readFile(path.join(f.directory,'account-avatars',url.split('/').at(-1)+'.jpg')));
});
