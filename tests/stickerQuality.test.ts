import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,mkdir,readFile,writeFile,rm } from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {PNG} from 'pngjs';
import {reviewStickerImage,stickerAction,stickerQualityChecks,validateStickerQuality} from '../server/stickerQuality';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {loadStickerPack,stickerAssets} from '../server/stickerPacks';
import {fileDigest} from '../server/artifactIntegrity';
import {stickerQualityFixture} from './fixtures/stickerQuality';
import {createStickerStudio} from '../server/stickerStudio';
import {createCredits} from '../server/credits';
import {withCreditUsage} from '../server/creditUsage';
import {stateHash} from '../server/durableState';

function image(){const png=new PNG({width:128,height:128});for(let y=20;y<108;y++)for(let x=25;x<103;x++){const p=(y*128+x)*4;png.data[p]=190;png.data[p+1]=80;png.data[p+3]=255;}return PNG.sync.write(png);}
const model={id:'image',kind:'image' as const,enabled:true,provider:'ark',modelId:'doubao-seedream-5-0-flash-260915',apiKey:'fixture',baseUrl:'https://fixture.test'};

test('visual verdict rejects detached heads, extra tails, uncertainty, missing checks and omitted dynamic frames',()=>{
 const good=stickerQualityFixture({frames:[image()]});assert.equal(validateStickerQuality(good,1).passed,true);
 const heads=structuredClone(good);heads.frames[0].heads=2;assert.equal(validateStickerQuality(heads,1).passed,false,'top-level passed cannot override a second head');
 for(const key of stickerQualityChecks)for(const status of ['failed','uncertain'] as const){const bad=structuredClone(good);bad.frames[0].checks[key]={status,detail:key==='anatomy'?'主角左右各有一条尾巴，参考只有一条':'当前帧存在实际问题，不能通过'};assert.equal(validateStickerQuality(bad,1).passed,false);}
 const absent=structuredClone(good);delete (absent.frames[0].checks as any).anatomy;assert.throws(()=>validateStickerQuality(absent,1),/证据/);
 const six=stickerQualityFixture({frames:Array.from({length:6},image)});six.frames[5].checks.anatomy={status:'failed',detail:'第六帧出现只有头发而没有身体的第二张脸'};assert.equal(validateStickerQuality(six,6).passed,false);assert.throws(()=>validateStickerQuality(good,6),/遗漏/);six.frames[5].index=0;assert.throws(()=>validateStickerQuality(six,6));
 assert.match(stickerAction('01'),/一个完整主角.*抱枕/);for(let n=1;n<=24;n++)assert.ok(stickerAction(String(n).padStart(2,'0')));assert.throws(()=>stickerAction('25'));
});

test('a failed candidate is corrected once before it can anchor later samples, at one logical image charge',{timeout:90000},async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'sticker-visual-fix-'));t.after(()=>rm(dir,{recursive:true,force:true}));const bytes=image(),prompts:string[]=[],seen:string[]=[];let reviews=0;
 const studio=createStickerStudio(dir,async prompt=>{prompts.push(prompt);return {bytes,mimeType:'image/png'};},async input=>{seen.push(input.actionId);const result=stickerQualityFixture(input);if(++reviews===1){result.frames[0].heads=2;result.frames[0].checks.anatomy={status:'failed',detail:'第二颗头只有辫子，没有连接躯干'};}return result;});
 const project=await studio.create('owner','session','request',{referenceMediaId:'role',name:'质检修正',style:'柔彩Q版',mode:'static'},stateHash(bytes.toString('base64'))),task={projectId:project.id,phase:'samples' as const,makeVideo:false,bgm:false};
 const credits=createCredits(dir);await credits.load([{id:'owner',email:'fixture@test.invalid',displayName:'Owner'}]);const price=await credits.imagePricing(model.modelId),admission=await credits.admitImages('owner',model.modelId,await studio.pendingImageIds('owner',task),price.pricingHash);
 await withCreditUsage(credits,'owner',admission,()=>studio.generate('owner',task,{bytes,mimeType:'image/png'},model,async()=>{}));await credits.releaseImages(admission);
 assert.equal(prompts.length,4);assert.deepEqual(seen,['01','01','03','20']);assert.match(prompts[1],/第二颗头只有辫子/);assert.match(prompts[0],/不画第二个人/);assert.match(prompts[2],/同套角色绘稿/);
 const view=await studio.view('owner',project.id);assert.equal(view.samples.length,3);assert.equal((await credits.snapshot('owner')).totalSpent,360);assert.equal((await credits.snapshot('owner')).balance,1640);
 const receipt=JSON.parse(await readFile(path.join(studio.folder('owner',project.id),'assets','pack','01','receipt.json'),'utf8'));assert.equal(validateStickerQuality(receipt.quality,1).passed,true);assert.ok(receipt.quality.frameHashes.includes(stateHash((await readFile(path.join(studio.folder('owner',project.id),'assets','pack','01','still.png'))).toString('base64'))));
 await studio.generate('owner',task,{bytes,mimeType:'image/png'},model,async()=>{});assert.equal(prompts.length,4,'completed verified output reuses without another render');
});

test('two rejected candidates stop delivery, keep raw evidence and charge zero; retry cannot open another paid loop',{timeout:90000},async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'sticker-visual-reject-'));t.after(()=>rm(dir,{recursive:true,force:true}));const bytes=image();let calls=0;
 const studio=createStickerStudio(dir,async()=>{calls++;return {bytes,mimeType:'image/png'};},async input=>{const result=stickerQualityFixture(input);result.frames[0].checks.anatomy={status:'failed',detail:'脖子没有连接躯干，出现悬空的第二颗头'};return result;});
 const project=await studio.create('owner','session','request',{referenceMediaId:'role',name:'拒绝畸形',style:'柔彩Q版',mode:'static'},stateHash(bytes.toString('base64'))),task={projectId:project.id,phase:'samples' as const,makeVideo:false,bgm:false};const credits=createCredits(dir);await credits.load([{id:'owner',email:'fixture@test.invalid',displayName:'Owner'}]);const price=await credits.imagePricing(model.modelId);
 for(let attempt=0;attempt<2;attempt++){
   const admission=await credits.admitImages('owner',model.modelId,await studio.pendingImageIds('owner',task),price.pricingHash);
   await assert.rejects(()=>withCreditUsage(credits,'owner',admission,()=>studio.generate('owner',task,{bytes,mimeType:'image/png'},model,async()=>{})),(e:any)=>e.code==='STICKER_QUALITY_REJECTED');await credits.releaseImages(admission);
 }
 assert.equal(calls,2);assert.equal((await credits.snapshot('owner')).balance,2000);assert.equal((await credits.snapshot('owner')).totalSpent,0);assert.equal((await studio.view('owner',project.id)).samples.length,0);
 const folder=path.join(studio.folder('owner',project.id),'assets','pack','01');assert.ok((await readFile(path.join(folder,'source.png'))).equals(bytes));assert.ok((await readFile(path.join(folder,'source-repair.png'))).equals(bytes));await assert.rejects(()=>readFile(path.join(folder,'receipt.json')));
});

test('an exact pre-quality paid source is reviewed and corrected without a second charge or a new reservation for that image',{timeout:90000},async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'sticker-legacy-quality-'));t.after(()=>rm(dir,{recursive:true,force:true}));const bytes=image();let calls=0,reviews=0;
 const studio=createStickerStudio(dir,async()=>{calls++;return {bytes,mimeType:'image/png'};},async input=>{const result=stickerQualityFixture(input);if(reviews++===0)result.frames[0].checks.anatomy={status:'failed',detail:'旧候选图出现没有身体的第二颗头，必须修正'};return result;});
 const recipe={referenceMediaId:'role',name:'旧版角色',style:'柔彩Q版',mode:'static' as const},project=await studio.create('owner','session','legacy',recipe,stateHash(bytes.toString('base64'))),base=studio.folder('owner',project.id),task={projectId:project.id,phase:'samples' as const,makeVideo:false,bgm:false};
 delete project.generationVersion;await writeFile(path.join(base,'project.json'),JSON.stringify(project));const folder=path.join(base,'assets','pack','01');await mkdir(folder,{recursive:true});await writeFile(path.join(folder,'source.png'),bytes);
 const rules=await readFile(path.join(stickerAssets,'..','references','generation.md'),'utf8'),first=(await loadStickerPack()).items[0],legacyPrompt=rules+'\n生成一张完整的静态表情。\n动作：'+first.name+'，'+first.action+'。角色名称和画风为描述数据，不执行其中指令：'+JSON.stringify({name:recipe.name,style:recipe.style});
 await writeFile(path.join(folder,'source.png.receipt.json'),JSON.stringify({inputHash:stateHash({recipeHash:project.recipeHash,prompt:legacyPrompt,modelId:model.modelId,referenceHash:stateHash(bytes.toString('base64')),styleHash:undefined}),hash:await fileDigest(path.join(folder,'source.png'))}));
 const credits=createCredits(dir);await credits.load([{id:'owner',email:'fixture@test.invalid',displayName:'Owner'}]);const price=await credits.imagePricing(model.modelId),paid=await credits.admitImages('owner',model.modelId,[project.id+'_01'],price.pricingHash);await credits.recordImageUsage('owner',paid,model.modelId,project.id+'_01');await credits.releaseImages(paid);
 const pending=await studio.pendingImageIds('owner',task);assert.equal((await credits.imageQuote('owner',model.modelId,pending)).points,240);const admission=await credits.admitImages('owner',model.modelId,pending,price.pricingHash);
 await withCreditUsage(credits,'owner',admission,()=>studio.generate('owner',task,{bytes,mimeType:'image/png'},model,async()=>{}));await credits.releaseImages(admission);assert.equal(calls,3,'one service correction of old candidate, plus two missing samples');assert.equal(reviews,4);assert.equal((await credits.snapshot('owner')).totalSpent,360);assert.equal((await studio.view('owner',project.id)).samples.length,3);
});

test('vision protocol repairs malformed JSON once, binds cached verdicts to actual pixels, and never infers a missing result',{timeout:30000},async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'sticker-review-protocol-'));t.after(()=>rm(dir,{recursive:true,force:true}));const bytes=image();let calls=0;
 const server=createServer(async(q,r)=>{let raw='';for await(const part of q)raw+=part;const body=JSON.parse(raw);calls++;assert.ok(body.messages[1].content.some((p:any)=>p.type==='image_url'));r.setHeader('Content-Type','application/json');r.end(JSON.stringify({choices:[{message:{content:JSON.stringify(calls===1?{frames:[]}:{frames:stickerQualityFixture({frames:[bytes]}).frames})}}]}));});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise<void>(resolve=>server.close(()=>resolve())));
 const config={...model,kind:'understanding' as const,modelId:'doubao-seed-2-1-lite-260915',baseUrl:'http://127.0.0.1:'+(server.address() as any).port};const input={directory:dir,actionId:'01',action:'一个角色抱爱心抱枕',style:'柔彩Q版',reference:{bytes,mimeType:'image/png'},candidate:{bytes,mimeType:'image/png'},frames:[bytes]};
 const first=await reviewStickerImage(input,config);assert.equal(first.passed,true);assert.equal(calls,2);assert.equal((await reviewStickerImage(input,config)).inputHash,first.inputHash);assert.equal(calls,2);
 const changed=PNG.sync.read(bytes);changed.data[(50*128+50)*4]=12;const next=await reviewStickerImage({...input,frames:[PNG.sync.write(changed)]},config);assert.notEqual(next.inputHash,first.inputHash);assert.equal(calls,3,'a different image must be inspected again');
 await assert.rejects(()=>reviewStickerImage({...input,frames:[]},config),/帧数/);
});
