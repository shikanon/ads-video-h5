import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {PNG} from 'pngjs';
import {prepareStickerExecutionRetry} from '../server/stickerRetry';
import {withTaskExecution,currentTaskExecution,OutcomeUnknownError} from '../server/taskRuntime';
import {createTaskSpec,taskSpecHash} from '../server/taskContract';
import {createStickerStudio} from '../server/stickerStudio';
import {stateHash} from '../server/durableState';
import {startCreditServer} from './fixtures/creditServer';
import {waitFor} from './fixtures/nativeClient';

test('explicit sticker recovery archives old execution bytes, retains call/cost budgets and cannot replay unknown effects',async t=>{
 const directory=await mkdtemp(path.join(tmpdir(),'sticker-legacy-run-'));t.after(()=>rm(directory,{recursive:true,force:true}));const spec=createTaskSpec([],'Sticker task','qingmao-stickers'),ledgerDirectory=path.join(directory,'effects'),base={directory,spec,ledgerDirectory,environmentHash:'old',assertCurrent(){},maxCalls:1};let writes=0;
 await withTaskExecution(base,async()=>{const r=currentTaskExecution()!;await r.consume();await r.external('confirmed',{},async()=>{writes++;return {receipt:'kept'};});await assert.rejects(r.external('uncertain',{},async()=>{writes++;throw Error('response lost');}));});
 const file=path.join(directory,'run.json'),original=JSON.parse(await readFile(file,'utf8'));Object.assign(original,{deadlineAt:1,spentMicros:120000000,usageSeen:{paid:true},plan:original.plan.map((p:any)=>({...p,status:'passed',projectHash:'old'})),evidence:{old:true}});await writeFile(file,JSON.stringify(original));const bytes=await readFile(file,'utf8'),effects=await readFile(path.join(ledgerDirectory,'effects.json'),'utf8');
 await assert.rejects(withTaskExecution({...base,environmentHash:'new'},async()=>{}),/环境已漂移/);
 const attemptId=randomUUID(),options={directory,spec,environmentHash:'new',attemptId,timeoutMs:60000,validate:async()=>stateHash('verified-project'),assertCurrent(){}};
 await prepareStickerExecutionRetry(options);const saved=JSON.parse(await readFile(file,'utf8'));assert.equal(saved.calls,1);assert.equal(saved.spentMicros,120000000);assert.deepEqual(saved.usageSeen,{paid:true});assert.ok(saved.deadlineAt>Date.now());assert.equal(saved.evidence,undefined);assert.ok(saved.plan.every((p:any)=>p.status==='pending'));assert.equal(await readFile(path.join(directory,'retry-history',saved.stickerRetry.previousRunHash+'.json'),'utf8'),bytes);assert.equal(await readFile(path.join(ledgerDirectory,'effects.json'),'utf8'),effects);
 const migrated=await readFile(file,'utf8');await prepareStickerExecutionRetry(options);assert.equal(await readFile(file,'utf8'),migrated);
 await withTaskExecution({...base,environmentHash:'new'},async()=>{const r=currentTaskExecution()!;await assert.rejects(r.consume(),/共享工具预算/);assert.equal((await r.external('confirmed',{},async()=>{writes++;return {receipt:'duplicate'};})).receipt,'kept');await assert.rejects(r.external('uncertain',{},async()=>{writes++;}),OutcomeUnknownError);});assert.equal(writes,2);
 const untouched=await readFile(file,'utf8');await assert.rejects(prepareStickerExecutionRetry({...options,attemptId:randomUUID(),spec:createTaskSpec([],'Changed','qingmao-stickers')}),/制作要求已变化/);assert.equal(await readFile(file,'utf8'),untouched);
 await assert.rejects(prepareStickerExecutionRetry({...options,attemptId:randomUUID(),validate:async()=>{throw Error('approval changed');}}),/approval changed/);assert.equal(await readFile(file,'utf8'),untouched);
});

test('real retry endpoint resumes a pre-deployment legacy sticker job with an expired execution record and bills each new image once',{timeout:120000},async t=>{
 let projectId='',oldRun='';const f=await startCreditServer({stickerImages:true,prepare:async directory=>{
  const image=new PNG({width:128,height:128});for(let y=20;y<108;y++)for(let x=30;x<98;x++){const p=(y*128+x)*4;image.data[p]=180;image.data[p+1]=80;image.data[p+3]=255;}const bytes=PNG.sync.write(image);
  const studio=createStickerStudio(directory),project=await studio.create('ordinary','ordinary-session','legacy-request',{referenceMediaId:'role',name:'旧角色续做',style:'柔彩Q版',mode:'static'},stateHash(bytes.toString('base64')));projectId=project.id;delete project.generationVersion;await writeFile(path.join(studio.folder('ordinary',project.id),'project.json'),JSON.stringify(project));
  await mkdir(path.join(directory,'media'),{recursive:true});await writeFile(path.join(directory,'media','role'),bytes);
  const state=JSON.parse(await readFile(path.join(directory,'app-state.json'),'utf8')),session=state.sessions[0],job=state.jobs[0];session.messages[0].text='@动态表情套装 为新角色生成3个样张，等待确认。';
  const spec=createTaskSpec(session.messages,session.messages[0].text,'qingmao-stickers');session.taskRevisions={[spec.id]:spec.revision};Object.assign(job,{kind:'export',taskSpec:spec,template:{id:'qingmao-stickers',name:'动态表情套装',version:'1.1.0',skillHash:'1'.repeat(64)},stickerGenerationTask:{projectId,phase:'samples',makeVideo:false,bgm:false},attempts:[{id:randomUUID(),number:1,status:'failed',kind:'export',startedAt:'2026-11-15T00:00:00Z'}]});
  state.media.push({id:'role',ownerId:'ordinary',kind:'image',name:'role.png',mimeType:'image/png',url:'/api/media/role',createdAt:new Date().toISOString()});await writeFile(path.join(directory,'app-state.json'),JSON.stringify(state));
  const run=path.join(directory,'agent-runs',job.id);await mkdir(run,{recursive:true});oldRun=JSON.stringify({contractHash:taskSpecHash(spec),environmentHash:'deployment-before-fix',deadlineAt:1,calls:0,plan:[{id:'technical',dependsOn:[],status:'pending'},{id:'requirements',dependsOn:['technical'],status:'pending'},{id:'deliver',dependsOn:['requirements'],status:'pending'}],checkpoints:[],actions:[]});await writeFile(path.join(run,'run.json'),oldRun);
 }});t.after(()=>f.close());const cookie=await f.login(),config:any=await(await f.request(cookie,'/api/sticker-projects/config')).json();
 const reply=await f.request(cookie,'/api/jobs/failed-job/retry',{pricingHash:config.pricing.pricingHash});assert.equal(reply.status,200,await reply.clone().text());
 await waitFor(async()=>{const s:any=await(await f.request(cookie,'/api/state')).json(),j=s.jobs.find((j:any)=>j.id==='failed-job');if(j.status==='failed')throw Error(JSON.stringify(j.failure));return j.status==='succeeded';},1500);
 const view:any=await(await f.request(cookie,'/api/sticker-projects/'+projectId)).json();assert.equal(view.project.samples.length,3);assert.equal(f.providerState.calls,3);const credits:any=await(await f.request(cookie,'/api/credits?limit=100')).json();assert.equal(credits.wallet.totalSpent,360);assert.equal(credits.wallet.balance,1640);assert.equal(credits.entries.filter((e:any)=>e.imageCount===1).length,3);
 const history=path.join(f.directory,'agent-runs','failed-job','retry-history'),names=await readdir(history);assert.equal(names.length,1);assert.equal(await readFile(path.join(history,names[0]),'utf8'),oldRun);
 assert.equal((await f.request(cookie,'/api/jobs/failed-job/retry',{pricingHash:config.pricing.pricingHash})).status,409);assert.equal(f.providerState.calls,3);
});
