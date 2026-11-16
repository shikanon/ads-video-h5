import test from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { createStickerStudio, validateStickerRecipe } from '../server/stickerStudio';
import { stateHash } from '../server/durableState';
import { startCreditServer } from './fixtures/creditServer';
import { capturePage } from './fixtures/nativeClient';
import { verifyStickerAssets, defaultStickerTask } from '../server/stickerPacks';
import { runStickerWorkflow } from '../server/stickerWorkflow';
import { createRequire } from 'node:module';
import { capture } from '../server/scienceRender';
import { runFFmpeg } from '../server/core';
import { stickerQualityFixture } from './fixtures/stickerQuality';
const recipe={referenceMediaId:'role',name:'新角色',style:'保留角色原有服装，柔彩Q版',mode:'static' as const};
function png(){const p=new PNG({width:128,height:128});for(let y=25;y<105;y++)for(let x=30;x<95;x++){const i=(y*128+x)*4;p.data[i]=190;p.data[i+1]=80;p.data[i+2]=40;p.data[i+3]=255;}return PNG.sync.write(p);}
function zipEntries(bytes:Buffer){const files=new Map<string,Buffer>();for(let offset=0;bytes.readUInt32LE(offset)===0x04034b50;){const size=bytes.readUInt32LE(offset+18),n=bytes.readUInt16LE(offset+26),extra=bytes.readUInt16LE(offset+28),start=offset+30+n+extra;files.set(bytes.toString('utf8',offset+30,offset+30+n),inflateRawSync(bytes.subarray(start,start+size)));offset=start+size;}return files;}

test('an obsolete sticker task is rejected before credit admission or a model request',async t=>{
  const f=await startCreditServer({obsoleteSticker:true});t.after(()=>f.close());const cookie=await f.login();
  const before=await(await f.request(cookie,'/api/credits?offset=0&limit=100')).json();
  const reply=await f.request(cookie,'/api/jobs/failed-job/retry',{});assert.equal(reply.status,409);const body:any=await reply.json();assert.equal(body.code,'STICKER_TEMPLATE_UPDATED');assert.match(body.error,/调整设定/);
  assert.deepEqual(await(await f.request(cookie,'/api/credits?offset=0&limit=100')).json(),before);assert.equal(f.providerState.calls,0);
});

test('project recipes, idempotency, approval fingerprint and account boundaries are enforced',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'sticker-studio-')),studio=createStickerStudio(dir);
  try{
    assert.deepEqual(validateStickerRecipe(recipe),recipe);
    for(const invalid of [{...recipe,mode:'gif'},{...recipe,style:''},{...recipe,referenceMediaId:'../other'},{...recipe,extra:'path'}])assert.throws(()=>validateStickerRecipe(invalid));
    const p=await studio.create('one','session','request',recipe,'hash'),again=await studio.create('one','session','request',recipe,'hash');assert.equal(p.id,again.id);
    await assert.rejects(()=>studio.create('one','session','request',{...recipe,name:'changed'},'hash'),/变化/);
    await assert.rejects(()=>studio.load('two',p.id),/不存在/);await assert.rejects(()=>studio.load('one','../escape'),/不存在/);
    await assert.rejects(()=>studio.approve('one',p.id,'forged'));assert.equal((await studio.view('one',p.id)).approved,false);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('real HTTP, image provider fixture, queue and static delivery require explicit samples approval',{timeout:180000},async t=>{
  const imageRequests:any[]=[];
  const f=await startCreditServer({stickerImages:true,onProviderRequest:async body=>{if(body.image)imageRequests.push(body);}});t.after(()=>f.close());const cookie=await f.login(),other=await f.login('shikanon@example.test');
  assert.equal((await fetch(f.base+'/api/sticker-projects')).status,401);
  const created=await f.request(cookie,'/api/sessions',{mode:'work'}),state:any=await created.json(),sessionId=state.activeSessionId;
  const pngFile=path.join(f.directory,'reference.png'),jpegFile=path.join(f.directory,'reference.jpg');await writeFile(pngFile,png());await runFFmpeg(['-v','error','-i',pngFile,'-frames:v','1',jpegFile]);
  const form=new FormData();form.append('files',new Blob([new Uint8Array(await readFile(jpegFile))],{type:'image/jpeg'}),'role.jpg');
  const uploaded=await fetch(f.base+'/api/media',{method:'POST',headers:{Cookie:cookie},body:form});assert.equal(uploaded.status,200);const upload:any=await uploaded.json();
  const referenceMediaId=upload.uploadedMediaIds[0],config:any=await(await f.request(cookie,'/api/sticker-projects/config')).json(),body={pricingHash:config.pricing.pricingHash,sessionId,requestId:'phase2_static_request_0001',recipe:{...recipe,referenceMediaId}};
  const original=Buffer.from(await(await f.request(cookie,upload.media.find((m:any)=>m.id===referenceMediaId).url)).arrayBuffer());
  assert.equal(original[0],0xff,'exercise the same JPEG reference format as the failed production task');
  const denied=await f.request(other,'/api/sticker-projects',body);assert.equal(denied.status,404);
  assert.equal(config.pricing.staticSamples,360);assert.equal(config.pricing.dynamicSamples,480);
  const missingPrice=await f.request(cookie,'/api/sticker-projects',{...body,pricingHash:undefined});assert.equal(missingPrice.status,409);assert.equal(f.providerState.calls,0);
  const first=await f.request(cookie,'/api/sticker-projects',body);assert.equal(first.status,202,await first.clone().text());const sent:any=await first.json(),id=sent.project.id;
  const duplicate=await f.request(cookie,'/api/sticker-projects',body);assert.equal(duplicate.status,202);assert.equal((await duplicate.json() as any).state.stickerJobId,sent.state.stickerJobId);
  assert.equal((await f.request(other,'/api/sticker-projects/'+id)).status,404);
  async function waitJob(jobId:string){for(let i=0;i<600;i++){const s:any=await(await f.request(cookie,'/api/state').catch(error=>{throw new Error(JSON.stringify(f.diagnostics()),{cause:error});})).json(),job=s.jobs.find((j:any)=>j.id===jobId);if(['succeeded','failed','cancelled'].includes(job.status)){assert.equal(job.status,'succeeded',JSON.stringify({error:job.error,failure:job.failure,diagnostics:f.diagnostics()}));return s;}await new Promise(r=>setTimeout(r,200));}throw Error('Job did not finish');}
  assert.equal((await f.request(cookie,'/api/sticker-projects/'+id+'/approve',{previewHash:'f'.repeat(64),makeVideo:false,bgm:false})).status,409);
  await waitJob(sent.state.stickerJobId);const view:any=await(await f.request(cookie,'/api/sticker-projects/'+id)).json();assert.equal(view.project.samples.length,3);assert.equal(view.project.approved,false);assert.equal(view.project.ready,false);assert.equal(f.providerState.calls,3);
  assert.equal(imageRequests.length,3);assert.equal(imageRequests[0].background,'opaque');assert.equal(imageRequests[0].output_format,'png');assert.match(imageRequests[0].prompt,/纯色抠图/);assert.deepEqual(Buffer.from(imageRequests[0].image.split(',')[1],'base64'),original);for(const request of imageRequests.slice(1)){assert.equal(request.background,'transparent');assert.ok(request.image.startsWith('data:image/png;base64,'));assert.match(request.prompt,/同套角色绘稿/);}
  assert.deepEqual(Buffer.from(await(await f.request(cookie,upload.media.find((m:any)=>m.id===referenceMediaId).url)).arrayBuffer()),original,'request conversion must not rewrite the stored source');
  assert.equal((await f.request(cookie,view.project.samples[0].thumbnailUrl)).status,200);assert.equal((await f.request(other,view.project.samples[0].thumbnailUrl)).status,404);
  assert.equal((await f.request(cookie,'/api/sticker-projects/'+id+'/approve',{previewHash:'f'.repeat(64),makeVideo:false,bgm:false})).status,409);
  const sampleCredits:any=await(await f.request(cookie,'/api/credits')).json();assert.equal(sampleCredits.wallet.balance,1640);assert.equal(sampleCredits.wallet.totalSpent,360);assert.equal(sampleCredits.wallet.reserved,undefined);
  const quote:any=await(await f.request(cookie,'/api/sticker-projects/'+id+'/quote?phase=batch')).json();assert.equal(quote.imageCount,21);assert.equal(quote.points,2520);assert.equal((await f.request(other,'/api/sticker-projects/'+id+'/quote?phase=batch')).status,404);
  const insufficient=await f.request(cookie,'/api/sticker-projects/'+id+'/approve',{pricingHash:quote.pricingHash,previewHash:view.project.previewHash,makeVideo:false,bgm:false});assert.equal(insufficient.status,402);assert.equal(f.providerState.calls,3);
  assert.equal((await f.request(cookie,'/api/credits/check-in',{date:sampleCredits.wallet.checkInDate})).status,200);
  const approve={pricingHash:quote.pricingHash,previewHash:view.project.previewHash,makeVideo:process.env.QINGJIAN_STICKER_RENDER_TEST==='1',bgm:true},batch=await f.request(cookie,'/api/sticker-projects/'+id+'/approve',approve);assert.equal(batch.status,202,await batch.clone().text());const batchReceipt:any=await batch.json();
  const finished=await waitJob(batchReceipt.state.stickerJobId),artifact=finished.artifacts.find((a:any)=>a.kind==='sticker-pack');assert.ok(artifact);assert.equal(artifact.sticker.mode,'static');assert.equal(f.providerState.calls,24,'approved samples must be reused');
  const repeated=await f.request(cookie,'/api/sticker-projects/'+id+'/approve',approve);assert.equal(repeated.status,202);assert.equal((await repeated.json() as any).state.stickerJobId,batchReceipt.state.stickerJobId);assert.equal(f.providerState.calls,24);
  const result=await f.request(cookie,artifact.downloadUrl),entries=zipEntries(Buffer.from(await result.arrayBuffer()));assert.equal(entries.size,29);assert.equal([...entries.keys()].filter(k=>k.endsWith('/静态.png')).length,24);assert.equal([...entries.keys()].some(k=>/\.(gif|webp)$/.test(k)),false);
  assert.equal((await f.request(other,artifact.downloadUrl)).status,404);assert.equal((await f.request(cookie,artifact.coverUrl)).status,200);
  const packs:any=await(await f.request(cookie,'/api/sticker-packs')).json(),custom=packs.packs.find((p:any)=>p.private);assert.equal(custom.mode,'static');assert.equal(custom.items.length,24);assert.ok(custom.items.every((item:any)=>item.previewUrl.endsWith('/still')));
  assert.equal((await f.request(cookie,'/api/sticker-packs/'+custom.id)).status,200);assert.equal((await f.request(other,'/api/sticker-packs/'+custom.id)).status,404);
  const stranger:any=await(await f.request(other,'/api/sticker-packs')).json();assert.equal(stranger.packs.some((p:any)=>p.id===custom.id),false);
  const credits:any=await(await f.request(cookie,'/api/credits?offset=0&limit=100')).json();assert.equal(credits.entries.filter((entry:any)=>entry.imageCount===1).length,24);assert.equal(credits.entries.some((entry:any)=>entry.kind==='usage_pending'),false);assert.equal(credits.wallet.balance,120);assert.equal(credits.wallet.totalSpent,2880);assert.equal(credits.wallet.reserved,undefined);
  assert.equal(f.providerState.qualityCalls,24,'every new image is visually inspected; review tokens are included rather than debited to the user');
  assert.equal(f.providerState.identityCalls,1,'one reference appearance record is reused for all actions and included in the quoted price');
  const studio=createStickerStudio(f.directory),manifest=await studio.pack('ordinary',custom.id);assert.match(await verifyStickerAssets(manifest!.pack,manifest!.assetsRoot),/^[a-f0-9]{64}$/);
  if(approve.makeVideo){const video=finished.artifacts.find((a:any)=>a.kind==='video');assert.ok(video);assert.equal(video.duration,24);assert.equal(video.hasBgm,true);assert.equal(video.sticker.sourceHash,artifact.sticker.sourceHash);assert.equal(video.sticker.packArtifactId,artifact.id);assert.equal((await f.request(other,video.downloadUrl)).status,404);const project=zipEntries(Buffer.from(await(await f.request(cookie,video.projectUrl)).arrayBuffer())),verification=JSON.parse(project.get('verification.json')!.toString());assert.equal(verification.decodedFrames,720);assert.equal(verification.fullDecode,true);assert.equal(JSON.parse(project.get('config.json')!.toString()).packId,custom.id);}
});

test('dynamic generation produces six distinct drawings, ten-frame exports and refuses changed approval assets',{timeout:180000},async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'sticker-dynamic-')),reference={bytes:png(),mimeType:'image/png'};let calls=0;
  const fixture=async(_prompt:string,_model:any,input:any,options:any)=>{calls++;if(calls===1){assert.equal(options.size,'2048x2048');return {bytes:png(),mimeType:'image/png'};}assert.equal(options.size,'2496x1664');assert.equal(options.background,'transparent');const reference=PNG.sync.read(input.bytes);assert.equal(reference.data[3],0);assert.equal(reference.width,2496);assert.equal(reference.height,1664);const p=new PNG({width:384,height:256});for(let n=0;n<6;n++)for(let y=25;y<105;y++)for(let x=30;x<95+n*2;x++){const i=((Math.floor(n/3)*128+y)*384+n%3*128+x)*4;p.data[i]=140+n*12;p.data[i+1]=60;p.data[i+2]=30;p.data[i+3]=255;}return {bytes:PNG.sync.write(p),mimeType:'image/png'};};
  const studio=createStickerStudio(dir,fixture,async input=>stickerQualityFixture(input)),model:any={modelId:'fixture-image',apiKey:'fixture-secret'},project=await studio.create('one','session','dynamic-request',{...recipe,mode:'dynamic'},stateHash(reference.bytes.toString('base64')));
  try {
    await assert.rejects(()=>studio.generate('one',{projectId:project.id,phase:'batch',makeVideo:false,bgm:false},reference,model,async()=>{}),/确认/);
    const task={projectId:project.id,phase:'samples' as const,makeVideo:false,bgm:false};await studio.generate('one',task,reference,model,async()=>{});assert.equal(calls,4,'one reusable character drawing precedes three action sheets');
    const view=await studio.view('one',project.id);assert.match(view.previewHash,/^[a-f0-9]{64}$/);await studio.approve('one',project.id,view.previewHash);
    await studio.generate('one',task,reference,model,async()=>{});assert.equal(calls,4,'retries reuse the character drawing and verified action sheets');
    const base=path.join(studio.folder('one',project.id),'assets','pack','01'),probe=createRequire(import.meta.url)('ffprobe-static').path;
    for(const name of ['animation.gif','animation.png']){const report=JSON.parse((await capture(probe,['-v','error','-count_frames','-show_streams','-of','json',path.join(base,name)])).toString());assert.equal(Number(report.streams[0].nb_read_frames),10);assert.equal(report.streams[0].width,512);assert.equal(report.streams[0].height,512);}
    const bytes=await readFile(path.join(base,'animation.webp'));assert.ok(bytes.includes(Buffer.from('ANIM')));assert.ok(bytes.includes(Buffer.from('ANMF')));
    const image=PNG.sync.read(await readFile(path.join(base,'still.png')));assert.equal(image.data[3],0);
    const batch={...task,phase:'batch' as const,approvalHash:view.previewHash};
    await assert.rejects(()=>studio.generate('one',batch,reference,{...model,modelId:'changed'},async()=>{}),/切换/);assert.equal(calls,4);
    await studio.generate('one',batch,reference,model,async()=>{});assert.equal(calls,25);
    const built=await studio.pack('one','custom-'+project.id);assert.ok(built);await verifyStickerAssets(built.pack,built.assetsRoot);
    const delivered=await runStickerWorkflow({...built,task:{...defaultStickerTask(built.pack),makeVideo:false},directory:path.join(dir,'delivery'),progress:async()=>{}});
    const entries=zipEntries(await readFile(delivered.archive));assert.equal(entries.size,101);assert.ok(entries.has('贴贴/动画.gif'));assert.ok(entries.has('心动/动画-APNG.png'));
    await studio.generate('one',batch,reference,model,async()=>{});assert.equal(calls,25);
    await writeFile(path.join(base,'still.png'),png());await assert.rejects(()=>studio.generate('one',batch,reference,model,async()=>{}));assert.equal(calls,25,'changed approvals stop before a paid call');
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('WeChat accounts create without invitations; provider failure releases unused image points',{timeout:60000},async t=>{
  let f:Awaited<ReturnType<typeof startCreditServer>>;
  f=await startCreditServer({wechat:true,stickerImages:true,onProviderRequest:async body=>{if(body.image&&f.providerState.calls===2)f.providerState.fail=true;}});t.after(()=>f.close());
  async function login(code:string){const r=await fetch(f.base+'/api/auth/wechat/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code})});assert.equal(r.status,201);return r.headers.get('set-cookie')!.split(';')[0];}
  const cookie=await login('alice-image-credit'),other=await login('bob-image-credit');
  const config:any=await(await f.request(cookie,'/api/sticker-projects/config')).json(),state:any=await(await f.request(cookie,'/api/sessions',{mode:'work'})).json();
  const form=new FormData();form.append('files',new Blob([new Uint8Array(png())],{type:'image/png'}),'role.png');
  const uploaded:any=await(await fetch(f.base+'/api/media',{method:'POST',headers:{Cookie:cookie},body:form})).json();
  const accepted=await f.request(cookie,'/api/sticker-projects',{sessionId:state.activeSessionId,requestId:'wechat_own_points_001',pricingHash:config.pricing.pricingHash,recipe:{...recipe,referenceMediaId:uploaded.uploadedMediaIds[0]}});assert.equal(accepted.status,202,await accepted.clone().text());
  const receipt:any=await accepted.json();let finished:any;
  for(let i=0;i<200;i++){const current:any=await(await f.request(cookie,'/api/state')).json();finished=current.jobs.find((j:any)=>j.id===receipt.state.stickerJobId);if(finished.status==='failed')break;await new Promise(r=>setTimeout(r,100));}
  assert.equal(finished.status,'failed');const ledger:any=await(await f.request(cookie,'/api/credits')).json();assert.equal(ledger.wallet.balance,1880);assert.equal(ledger.wallet.totalSpent,120);assert.equal(ledger.wallet.reserved,undefined);assert.equal(f.providerState.calls,2);
  const quote:any=await(await f.request(cookie,'/api/sticker-projects/'+receipt.project.id+'/quote?phase=samples')).json();assert.equal(quote.points,240);assert.equal(quote.imageCount,2);
  assert.equal((await f.request(other,'/api/sticker-projects/'+receipt.project.id)).status,404);assert.equal((await(await f.request(other,'/api/credits')).json() as any).wallet.balance,2000);
});

test('studio page submits mode explicitly, preserves request IDs and ignores stale account responses',async()=>{
  const calls:any[]=[],state:any={credits:{balance:3000},activeSessionId:'session',sessions:[{id:'session',messages:[]}],media:[],jobs:[],artifacts:[]};let finish:any;
  const app:any={_generation:1,state,subscribe:()=>()=>{},refresh:async()=>app.state,apply(s:any){app.state=s;},client:{hasSession:()=>true,previewUrl:()=>'',request:async(route:string,body:any)=>{if(route.endsWith('/config'))return {available:true,pricing:{pricingHash:'price',staticSamples:360,dynamicSamples:480,pointsPerImage:120}};if(!body)return {projects:[]};calls.push(body);return new Promise(resolve=>{finish=resolve});}}};
  const page=await capturePage('sticker-studio',app,{showShareMenu(){}});page.onLoad({mode:'static'});page.onShow();await new Promise(r=>setTimeout(r,0));
  page.setData({referenceId:'role',name:'我的角色'});const pending=page.start();assert.equal(calls[0].recipe.mode,'static');assert.equal(calls.length,1);await page.start();assert.equal(calls.length,1);
  page.onHide();app._generation++;app.state={...state,activeSessionId:'new'};page.onShow();finish({state,project:{id:'old',samples:[]}});await pending;assert.equal(page.data.project,null);assert.equal(page.data.referenceId,'');assert.equal(page._sessionId,'new');page.onUnload();
});

test('private pack preview and ZIP sharing cannot complete after an account switch',async()=>{
  const state:any={activeSessionId:'a',sessions:[{id:'a'}],jobs:[],artifacts:[{id:'bundle',kind:'sticker-pack',name:'私有套装',downloadUrl:'/private.zip',sticker:{packId:'custom-owned'}}]};
  const pack:any={id:'custom-owned',private:true,mode:'static',name:'自己的角色',count:24,defaultSceneIds:['01','02','03','04','05','06'],items:Array.from({length:24},(_,n)=>({id:String(n+1).padStart(2,'0'),name:'动作'+n,thumbnailUrl:'',previewUrl:'/private-preview'}))};
  let finish:any,shared=0;
  const app:any={_generation:1,state,subscribe:()=>()=>{},refresh:async()=>app.state,client:{hasSession:()=>true,request:async()=>({packs:[pack]}),cachedDownload:()=>'',download:()=>new Promise(resolve=>{finish=resolve})}};
  const page=await capturePage('stickers',app,{showShareMenu(){},shareFileMessage(){shared++;}});page.onLoad({artifactId:'bundle'});page.onShow();await new Promise(r=>setTimeout(r,0));
  const preview=page.preview({currentTarget:{dataset:{id:'01'}}});page.onHide();app._generation++;page.onShow();finish('old-private-image');await preview;assert.equal(page.data.selected,null);
  page._artifact=state.artifacts[0];const download=page.download();await new Promise(r=>setTimeout(r,0));page.onHide();app._generation++;finish('old-private.zip');await download;assert.equal(shared,0);page.onUnload();
});
