import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {PNG} from 'pngjs';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createStickerStudio} from '../server/stickerStudio';
import {stickerQualityFixture} from './fixtures/stickerQuality';
import {readStickerIdentity} from '../server/stickerQuality';
import {createCredits} from '../server/credits';
import {withCreditUsage} from '../server/creditUsage';
import {stateHash} from '../server/durableState';
import {fileDigest} from '../server/artifactIntegrity';
import {toolCatalog} from '../server/toolCatalog';
import {loadVideoTemplateCatalog,publicTemplate} from '../server/videoTemplates';
import {stickerStyles} from '../server/stickerStyles';
import {jobFailureMessage} from '../server/jobAttempts';
import {capturePage,loadNativeApp,nativePlatform,waitFor} from './fixtures/nativeClient';
import {startCreditServer} from './fixtures/creditServer';

function image(n=0){const p=new PNG({width:128,height:128});for(let y=25;y<105;y++)for(let x=30;x<95;x++){const i=(y*128+x)*4;p.data[i]=190+n;p.data[i+1]=80;p.data[i+2]=40;p.data[i+3]=255;}return PNG.sync.write(p);}
const model={id:'image',kind:'image' as const,enabled:true,provider:'ark',modelId:'doubao-seedream-5-0-flash-260915',apiKey:'fixture',baseUrl:'https://fixture.test'};
const recipe={referenceMediaId:'role',name:'我的角色',style:'保留原角色服装和配饰',styleId:'lightmao' as const,styleSelection:'lightmao' as const,mode:'static' as const};

test('both candidates use all 24 curated references, require a real selection, and all 24 actions share one locked drawing',{timeout:90000},async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'sticker-style-choice-'));t.after(()=>rm(dir,{recursive:true,force:true}));let calls=0;const inputs:Array<{reference:Buffer;prompt:string}>=[];
  const studio=createStickerStudio(dir,async(prompt,_config,reference)=>{inputs.push({reference:reference!.bytes,prompt});return {bytes:image(++calls),mimeType:'image/png'};},async input=>stickerQualityFixture(input));
  const reference={bytes:image(),mimeType:'image/png'},p=await studio.create('owner','session','request',recipe,stateHash(reference.bytes.toString('base64'))),base=studio.folder('owner',p.id);
  const guides=JSON.parse(await readFile(path.join(base,'style-guides.json'),'utf8'));assert.equal(guides.length,2);for(const guide of guides){assert.equal(Object.keys(guide.sources).length,25);assert.equal(Object.keys(guide.sources).filter(f=>f.startsWith('pack/')).length,24);assert.equal(await fileDigest(path.join(base,guide.file)),guide.hash);}
  const credits=createCredits(dir);await credits.load([{id:'owner',email:'fixture@test.invalid',displayName:'Owner'}]);await credits.checkIn('owner',(await credits.snapshot('owner')).checkInDate);
  const price=await credits.imagePricing(model.modelId),styles={projectId:p.id,phase:'styles' as const,makeVideo:false,bgm:false};
  async function run(task:Parameters<typeof studio.generate>[1]){const hold=await credits.admitImages('owner',model.modelId,await studio.pendingImageIds('owner',task),price.pricingHash);try{return await withCreditUsage(credits,'owner',hold,()=>studio.generate('owner',task,reference,model,async()=>{}));}finally{await credits.releaseImages(hold);}}
  await assert.rejects(()=>studio.generate('owner',{...styles,phase:'samples'},reference,model,async()=>{}),/选择/);assert.equal(calls,0);
  await run(styles);let view=await studio.view('owner',p.id);assert.equal(calls,2);assert.equal(view.styleCandidates.length,2);assert.equal(view.samples.length,0);assert.equal(view.styleSelection,null);assert.equal((await credits.snapshot('owner')).totalSpent,240);
  await run(styles);assert.equal(calls,2,'refresh/retry reuses both candidates without extra debit');assert.equal((await credits.snapshot('owner')).totalSpent,240);
  await assert.rejects(()=>studio.selectStyle('other',p.id,'round',view.styleCandidates[1].hash),/不存在/);
  await assert.rejects(()=>studio.selectStyle('owner',p.id,'round','f'.repeat(64)),/当前画风/);
  const chosen=view.styleCandidates.find(v=>v.id==='round')!,selection=await studio.selectStyle('owner',p.id,'round',chosen.hash);
  assert.equal((await studio.selectStyle('owner',p.id,'round',chosen.hash)).hash,selection.hash);
  await assert.rejects(()=>studio.selectStyle('owner',p.id,'soft',view.styleCandidates[0].hash),/锁定/);
  const task={...styles,phase:'samples' as const,styleSelectionHash:selection.hash};
  await assert.rejects(()=>studio.generate('owner',{...task,styleSelectionHash:'f'.repeat(64)},reference,model,async()=>{}),/选择/);
  await run(task);view=await studio.view('owner',p.id);assert.equal(calls,5);assert.equal(view.samples.length,3);assert.equal(view.approved,false);assert.equal(view.ready,false);assert.equal((await credits.snapshot('owner')).totalSpent,600);
  const anchor=await readFile(path.join(base,'styles','round','still.png'));for(const input of inputs.slice(2)){assert.deepEqual(input.reference,anchor);assert.match(input.prompt,/同套角色绘稿/);}
  await assert.rejects(()=>studio.generate('owner',{...task,phase:'batch',approvalHash:'f'.repeat(64)},reference,model,async()=>{}),/确认/);assert.equal(calls,5);
  await credits.setSpecial('owner',true);
  await studio.approve('owner',p.id,view.previewHash);await run({...task,phase:'batch',approvalHash:view.previewHash});view=await studio.view('owner',p.id);assert.equal(view.ready,true);assert.equal(calls,26);for(const input of inputs.slice(2))assert.deepEqual(input.reference,anchor);assert.equal((await credits.snapshot('owner')).totalSpent,3120);
  await writeFile(path.join(base,'styles','round','still.png'),image(90));await assert.rejects(()=>studio.retryProof('owner',task,reference.bytes),/画风/);
});

test('reference assessment gives concrete replacement advice before any image request; uncertain or malformed replies fail closed',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'sticker-input-check-'));t.after(()=>rm(dir,{recursive:true,force:true}));let verdict:any={usable:false,reason:'角色位于截图角落，脸部与服装无法辨认。',advice:'请换一张单个角色占据主要画面、脸部和服装清晰的原图。'};let calls=0;
  const server=createServer(async(q,r)=>{for await(const _ of q){}calls++;r.setHeader('Content-Type','application/json');r.end(JSON.stringify({choices:[{message:{content:JSON.stringify(verdict)}}]}));});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise<void>(resolve=>server.close(()=>resolve())));
  const config={...model,kind:'understanding' as const,modelId:'doubao-seed-2-1-pro-260915',baseUrl:'http://127.0.0.1:'+(server.address() as any).port},reference={bytes:image(),mimeType:'image/png'};let imageCalls=0;
  const studio=createStickerStudio(dir,async()=>{imageCalls++;return {bytes:image(),mimeType:'image/png'};},async input=>stickerQualityFixture(input),(ref,_config,directory)=>readStickerIdentity(ref,config,directory));
  const p=await studio.create('owner','session','request',recipe,stateHash(reference.bytes.toString('base64')));
  await assert.rejects(()=>studio.generate('owner',{projectId:p.id,phase:'styles',makeVideo:false,bgm:false},reference,model,async()=>{}),(e:any)=>e.code==='STICKER_REFERENCE_UNSUITABLE'&&/角落/.test(jobFailureMessage(e,'记录角色外观'))&&/请换一张/.test(e.message));assert.equal(imageCalls,0);assert.equal(calls,1);
  verdict={identity:'未返回明确适用性判断，不得默认可用',uncertainties:''};await assert.rejects(()=>readStickerIdentity(reference,config,dir),/适用性/);
  verdict={usable:true,reason:'半身角色清楚可辨',advice:'',identity:'原图为一个清晰角色，保留发型服装；下半身未展示，不猜测。',uncertainties:'下半身不可见'};assert.match(await readStickerIdentity(reference,config,dir),/下半身/);
  assert.match(jobFailureMessage(Object.assign(Error('InputImageSensitiveContentDetected'),{code:'InputImageSensitiveContentDetected'}),'制图'),/可能是误判|可能误判/);
});

test('dynamic samples reuse the selected drawing in six cells and do not buy another identity drawing',{timeout:90000},async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'sticker-choice-dynamic-'));t.after(()=>rm(dir,{recursive:true,force:true}));let calls=0;const references:Buffer[]=[];
  const studio=createStickerStudio(dir,async(_prompt,_config,reference,options)=>{
    calls++;if(calls<=2){assert.equal(options?.size,'2048x2048');return {bytes:image(calls),mimeType:'image/png'};}
    references.push(reference!.bytes);assert.equal(options?.background,'transparent');assert.equal(options?.size,'2496x1664');
    const p=new PNG({width:384,height:256});for(let n=0;n<6;n++)for(let y=25;y<105;y++)for(let x=30;x<95+n*2;x++){const i=((Math.floor(n/3)*128+y)*384+n%3*128+x)*4;p.data[i]=140+n*12;p.data[i+1]=60;p.data[i+2]=30;p.data[i+3]=255;}return {bytes:PNG.sync.write(p),mimeType:'image/png'};
  },async input=>stickerQualityFixture(input));
  const reference={bytes:image(),mimeType:'image/png'},p=await studio.create('owner','session','dynamic-choice',{...recipe,mode:'dynamic'},stateHash(reference.bytes.toString('base64'))),task={projectId:p.id,phase:'styles' as const,makeVideo:false,bgm:false};
  await studio.generate('owner',task,reference,model,async()=>{});const view=await studio.view('owner',p.id),selected=await studio.selectStyle('owner',p.id,'soft',view.styleCandidates.find(v=>v.id==='soft')!.hash),samples={...task,phase:'samples' as const,styleSelectionHash:selected.hash};
  assert.deepEqual(await studio.pendingImageIds('owner',samples),['01','03','20'].map(id=>p.id+'_'+id));
  await studio.generate('owner',samples,reference,model,async()=>{});assert.equal(calls,5);assert.equal((await studio.view('owner',p.id)).samples.length,3);assert.equal(references.length,3);for(const ref of references.slice(1))assert.deepEqual(ref,references[0]);
  assert.deepEqual(await studio.pendingImageIds('owner',samples),[]);await studio.generate('owner',samples,reference,model,async()=>{});assert.equal(calls,5);
});

test('native tool discovery drops sample media even if an old backend still supplies it',async()=>{
  const templates=(await loadVideoTemplateCatalog()).map(publicTemplate),catalog=toolCatalog(templates);assert.ok(catalog.length>0);for(const item of catalog){assert.equal('sample' in item,false);assert.ok(item.tool.input);assert.ok(item.tool.steps.length>=3);assert.ok(item.tool.result);}
  assert.deepEqual(stickerStyles.map(s=>s.id),['lightmao','custom']);
  const {createRequire}=await import('node:module'),require=createRequire(import.meta.url),cards=require('../apps/miniprogram/miniprogram/utils/templates.js').galleryCards(templates,{templateAssetUrl(){throw Error('must not load sample assets');}});
  assert.ok(cards.every((c:any)=>c.sample===null));assert.equal(cards.find((c:any)=>c.id==='qingmao-stickers').studioMode,'dynamic');
});

test('native candidate click submits the chosen image hash once, and merely previewing never starts generation',async()=>{
  const platform=nativePlatform('http://127.0.0.1:1','/unused'),app=await loadNativeApp(platform),calls:any[]=[];
  const project={id:'p',sessionId:'s',createdAt:'2026-11-17',recipe,samples:[],styleCandidates:[{id:'soft',hash:'a'.repeat(64),name:'柔彩肖像Q版',previewUrl:'/private/soft'},{id:'round',hash:'b'.repeat(64),name:'圆萌大眼Q版',previewUrl:'/private/round'}],previewHash:'',completed:[]};
  app.state={activeSessionId:'s',sessions:[{id:'s',messages:[]}],jobs:[{id:'styles-job',sessionId:'s',status:'succeeded',stickerGenerationTask:{projectId:'p',phase:'styles'}}],media:[],artifacts:[],credits:{balance:2000}};app.refresh=async()=>app.state;
  let finish:any;app.client={hasSession:()=>true,previewUrl:()=>'',download:async(url:string)=>'local:'+url,request:async(route:string,body:any)=>{calls.push({route,body});if(route.endsWith('/config'))return {available:true,pricing:{styleCandidates:240,selectedSamples:360,pointsPerImage:120}};if(route==='/api/sticker-projects')return {projects:[project]};if(route.includes('/quote?'))return {points:360,pricingHash:'price',imageCount:3};if(route.endsWith('/style'))return new Promise(resolve=>{finish=()=>resolve({project:{...project,styleSelection:{id:'round'}},state:app.state});});throw Error(route);}};
  const page=await capturePage('sticker-studio',app,platform);page.onLoad({mode:'static',projectId:'p'});page.onShow();await waitFor(()=>Boolean(page.data.quote));await page.previewCandidate({currentTarget:{dataset:{id:'round'}}});assert.equal(calls.some(c=>c.body),false);
  const pending=page.selectCandidate({currentTarget:{dataset:{id:'round'}}});await page.selectCandidate({currentTarget:{dataset:{id:'soft'}}});assert.equal(calls.filter(c=>c.route.endsWith('/style')).length,1);assert.equal(calls.find(c=>c.body).body.candidateHash,'b'.repeat(64));finish();await pending;page.onUnload();clearTimeout(app._cacheTimer);
});

test('concurrent reference, candidate and completed-image thumbnail loads do not cancel one another',async()=>{
  const {createRequire}=await import('node:module'),require=createRequire(import.meta.url),{loadThumbnails}=require('../apps/miniprogram/miniprogram/utils/thumbnails.js');
  const pending=new Map<string,(v:string)=>void>(),client={download:(url:string)=>new Promise<string>(resolve=>pending.set(url,resolve))};
  const page:any={_visible:true,data:{references:[{id:'role',coverSource:'/role'}],candidates:[{id:'soft',coverSource:'/soft'}],completed:[{id:'01',coverSource:'/01'}]},setData(data:any){Object.assign(this.data,data);}};
  const work=Promise.all(['references','candidates','completed'].map(field=>loadThumbnails(page,field,client)));for(const [url,finish]of pending)finish('local:'+url);await work;
  for(const field of ['references','candidates','completed'])assert.match(page.data[field][0].cover,/^local:/);
});

test('HTTP queue stops after two styles, protects candidate previews, and starts samples only on an idempotent selection',{timeout:180000},async t=>{
  const f=await startCreditServer({stickerImages:true});t.after(()=>f.close());const cookie=await f.login(),other=await f.login('shikanon@example.test');
  const catalog:any=await(await f.request(cookie,'/api/templates?surface=tools')).json();assert.ok(catalog.templates.every((item:any)=>!item.sample&&item.tool));
  const state:any=await(await f.request(cookie,'/api/sessions',{mode:'work'})).json(),sessionId=state.activeSessionId;
  const form=new FormData();form.append('files',new Blob([new Uint8Array(image())],{type:'image/png'}),'role.png');
  const upload:any=await(await fetch(f.base+'/api/media',{method:'POST',headers:{Cookie:cookie},body:form})).json();
  const config:any=await(await f.request(cookie,'/api/sticker-projects/config')).json();assert.deepEqual(config.styles.map((s:any)=>s.id),['lightmao','custom']);assert.equal(config.pricing.styleCandidates,240);
  const reply=await f.request(cookie,'/api/sticker-projects',{sessionId,requestId:'style_choice_http_001',recipe:{...recipe,referenceMediaId:upload.uploadedMediaIds[0]},pricingHash:config.pricing.pricingHash});assert.equal(reply.status,202,await reply.clone().text());const sent:any=await reply.json(),id=sent.project.id;
  async function done(jobId:string){for(let n=0;n<300;n++){const state:any=await(await f.request(cookie,'/api/state')).json(),job=state.jobs.find((j:any)=>j.id===jobId);if(['succeeded','failed'].includes(job.status)){assert.equal(job.status,'succeeded',JSON.stringify(job.failure));return state;}await new Promise(r=>setTimeout(r,200));}throw Error('queue timeout');}
  const styled=await done(sent.state.stickerJobId);assert.match(styled.sessions.find((s:any)=>s.id===sessionId).messages.at(-1).text,/你想选择哪一种/);assert.equal(f.providerState.calls,2);
  let view:any=(await(await f.request(cookie,'/api/sticker-projects/'+id)).json()).project;assert.equal(view.samples.length,0);assert.equal(view.styleCandidates.length,2);assert.equal((await f.request(other,view.styleCandidates[0].previewUrl)).status,404);assert.equal((await fetch(f.base+view.styleCandidates[0].previewUrl)).status,401);assert.equal((await f.request(cookie,view.styleCandidates[0].previewUrl)).status,200);
  const quote:any=await(await f.request(cookie,'/api/sticker-projects/'+id+'/quote?phase=samples')).json();assert.equal(quote.points,360);
  const selected=view.styleCandidates[1],body={id:selected.id,candidateHash:selected.hash,pricingHash:quote.pricingHash};
  const missing=await f.request(cookie,'/api/sticker-projects/'+id+'/style',{...body,candidateHash:'f'.repeat(64)});assert.equal(missing.status,409);assert.equal(f.providerState.calls,2);
  const start=await f.request(cookie,'/api/sticker-projects/'+id+'/style',body);assert.equal(start.status,202,await start.clone().text());const receipt:any=await start.json();await done(receipt.state.stickerJobId);
  const duplicate:any=await(await f.request(cookie,'/api/sticker-projects/'+id+'/style',body)).json();assert.equal(duplicate.state.stickerJobId,receipt.state.stickerJobId);assert.equal(f.providerState.calls,5);
  view=(await(await f.request(cookie,'/api/sticker-projects/'+id)).json() as any).project;assert.equal(view.samples.length,3);assert.equal(view.ready,false);assert.equal(view.approved,false);assert.equal(view.styleSelection.id,selected.id);
  const credits:any=await(await f.request(cookie,'/api/credits')).json();assert.equal(credits.wallet.totalSpent,600);assert.equal(credits.wallet.reserved,undefined);
});
