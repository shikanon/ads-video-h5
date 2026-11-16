import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,mkdir,writeFile,readFile,rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import express from 'express';
import { PNG } from 'pngjs';
import { createStickerStudio } from '../server/stickerStudio';
import { stickerQualityFixture } from './fixtures/stickerQuality';
import { createStickerShares } from '../server/stickerShares';
import { createCredits } from '../server/credits';
import { documentText } from '../server/chatDocuments';
import { conversationContext } from '../server/conversationContext';
import { jobFailureMessage } from '../server/jobAttempts';
import {withCreditUsage} from '../server/creditUsage';
import {stateHash} from '../server/durableState';
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
function zipDocument(xml:string){const data=Buffer.from(xml),name=Buffer.from('word/document.xml'),local=Buffer.alloc(30),central=Buffer.alloc(46),end=Buffer.alloc(22);local.writeUInt32LE(0x04034b50);local.writeUInt32LE(data.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(name.length,26);central.writeUInt32LE(0x02014b50);central.writeUInt32LE(data.length,20);central.writeUInt32LE(data.length,24);central.writeUInt16LE(name.length,28);const body=Buffer.concat([local,name,data]),directory=Buffer.concat([central,name]);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(body.length,16);return Buffer.concat([body,directory,end]);}
test('Word paragraphs, tables and role settings reach readable text without accepting arbitrary ZIPs or unbounded XML',()=>{
 const doc=zipDocument('<w:document><w:body><w:p><w:r><w:t>内阁首辅与世家大小姐</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>姓名：甲 &amp; 乙</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>');
 const parsed=documentText(doc,'设定.docx');assert.match(parsed.text,/内阁首辅与世家大小姐\n姓名：甲 & 乙/);assert.equal(parsed.truncated,false);
 assert.throws(()=>documentText(Buffer.from('fake'),'broken.docx'),/不完整/);assert.throws(()=>documentText(doc,'old.doc'),/另存/);assert.throws(()=>documentText(zipDocument('<!DOCTYPE a><w:t>x</w:t>'),'bad.docx'),/XML/);
 assert.equal(documentText(Buffer.from('角色'.repeat(40000)),'long.txt').text.length,60000);
});
test('early role instructions survive more than five rounds while recent corrections remain later in context',()=>{
 const history:any[]=[{id:'setting',role:'user',text:'人物甲是内阁首辅，人物乙是世家大小姐；按剧本续写。'}];for(let i=0;i<70;i++)history.push({id:'m'+i,role:i%2?'assistant':'user',text:'继续剧情'+i});history.push({id:'correction',role:'user',text:'改为第一人称'});
 const context=conversationContext(history);assert.match(context,/内阁首辅/);assert.ok(context.endsWith('user：改为第一人称'));assert.ok(context.length<=100000);
});
test('service fault refund is appended once, releases holds and preserves reusable image billing identities',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'sticker-refund-'));t.after(()=>rm(dir,{recursive:true,force:true}));const credits=createCredits(dir);await credits.load([{id:'owner',email:'owner@test.local',displayName:'Owner'}]);
 const model='doubao-seedream-5-0-flash-260915',price=await credits.imagePricing(model),task=await credits.admitImages('owner',model,['p_01','p_02','p_03'],price.pricingHash);
 await credits.recordImageUsage('owner',task,model,'p_01');await credits.recordImageUsage('owner',task,model,'p_02');await credits.releaseImages(task);
 const refunded=await Promise.all([credits.refundImageTask('owner',task,'服务器空间故障退回'),credits.refundImageTask('owner',task,'重复退回')]);assert.equal(refunded.reduce((a,b)=>a+b,0),240);
 const history=await credits.history('owner');assert.equal(history.wallet.balance,2000);assert.equal(history.wallet.totalSpent,0);assert.equal(history.entries.filter(e=>e.kind==='service_refund').length,1);assert.equal(history.entries.filter(e=>e.imageCount).length,2);
 assert.equal((await credits.imageQuote('owner',model,['p_01','p_02','p_03'])).imageCount,1);const again=createCredits(dir);await again.load();assert.equal(await again.refundImageTask('owner',task,'重启重复'),0);
});
test('partial completed images are available and explicit share previews are owner-scoped, revocable and disclose no private identifiers',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'sticker-share-'));t.after(()=>rm(dir,{recursive:true,force:true}));const studio=createStickerStudio(dir),recipe={referenceMediaId:'private-role',name:'我的作品',style:'PRIVATE_STYLE',mode:'static' as const,styleId:'round' as const};
 const p=await studio.create('private-owner','private-session','request',recipe,'reference-hash'),png=PNG.sync.write(new PNG({width:32,height:32}));
 for(const id of ['01','02','03','04','05','06','07','20']){const base=path.join(studio.folder('private-owner',p.id),'assets','pack',id);await mkdir(base,{recursive:true});const files:Record<string,string>={};for(const name of ['still.png','thumb.png','atlas.webp']){await writeFile(path.join(base,name),png);files[name]=hash(png);}await writeFile(path.join(base,'receipt.json'),JSON.stringify({id,files,modelId:'fixture'}));}
 const view=await studio.view('private-owner',p.id);assert.equal(view.samples.length,3);assert.equal(view.completed.length,8);assert.equal(view.ready,false);assert.equal(view.compatible,true);
 const shares=createStickerShares(dir,studio,'/qingjian'),app=express();shares.mountPublic(app);const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));t.after(()=>new Promise<void>(resolve=>server.close(()=>resolve())));const base='http://127.0.0.1:'+(server.address() as any).port;
 await assert.rejects(()=>shares.create('stranger',p.id),/不存在/);const share=await shares.create('private-owner',p.id),response=await fetch(base+'/api/sticker-shares/'+share.token),value:any=await response.json();assert.equal(response.status,200);assert.equal(value.share.count,8);
 for(const secret of ['private-owner','private-session','private-role','PRIVATE_STYLE',p.id])assert.equal(JSON.stringify(value).includes(secret),false);
 assert.equal((await fetch(base+value.share.items[0].previewUrl.replace('/qingjian',''))).status,200);await assert.rejects(()=>shares.revoke('stranger',p.id,share.token));
 await shares.revoke('private-owner',p.id,share.token);assert.equal((await fetch(base+'/api/sticker-shares/'+share.token)).status,404);assert.equal((await fetch(base+value.share.items[0].previewUrl.replace('/qingjian',''))).status,404);
 const stale=await shares.create('private-owner',p.id),itemDir=path.join(studio.folder('private-owner',p.id),'assets','pack','01'),changed=new PNG({width:32,height:32});changed.data.fill(255);const replacement=PNG.sync.write(changed),record=JSON.parse(await readFile(path.join(itemDir,'receipt.json'),'utf8'));await writeFile(path.join(itemDir,'thumb.png'),replacement);record.files['thumb.png']=hash(replacement);await writeFile(path.join(itemDir,'receipt.json'),JSON.stringify(record));
 assert.equal((await fetch(base+'/api/sticker-shares/'+stale.token)).status,404);assert.equal((await shares.list('private-owner',p.id)).length,0,'a corrected sample must not reload an obsolete share token');assert.notEqual((await studio.view('private-owner',p.id)).samples[0].thumbnailUrl,view.samples[0].thumbnailUrl,'new pixels bypass the native persistent preview cache');const renewed=await shares.create('private-owner',p.id);assert.equal((await fetch(base+'/api/sticker-shares/'+renewed.token)).status,200);
 const old=JSON.parse(await readFile(path.join(studio.folder('private-owner',p.id),'project.json'),'utf8'));delete old.generationVersion;await writeFile(path.join(studio.folder('private-owner',p.id),'project.json'),JSON.stringify(old));assert.equal((await studio.pendingImageIds('private-owner',{projectId:p.id,phase:'batch',makeVideo:false,bgm:false})).length,16);
 await assert.rejects(()=>studio.assertCapacity(1000000),(e:any)=>e.code==='STICKER_STORAGE_LOW');
 assert.match(jobFailureMessage(Object.assign(Error('space'),{code:'STICKER_STORAGE_LOW'}),undefined),/未生成部分.*释放/);
});
test('post-processing repair reuses the paid original without another image request or debit',{timeout:60000},async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'sticker-source-repair-'));t.after(()=>rm(dir,{recursive:true,force:true}));const p=new PNG({width:128,height:128});for(let y=20;y<108;y++)for(let x=25;x<103;x++){const n=(y*128+x)*4;p.data[n]=200;p.data[n+1]=100;p.data[n+3]=255;}const bytes=PNG.sync.write(p);let calls=0;
 const studio=createStickerStudio(dir,async()=>{calls++;return {bytes,mimeType:'image/png'};},async input=>stickerQualityFixture(input)),project=await studio.create('owner','session','request',{referenceMediaId:'role',name:'修复验收',style:'柔彩Q版',mode:'static'},stateHash(bytes.toString('base64'))),credits=createCredits(dir);await credits.load([{id:'owner',email:'a@fixture.test',displayName:'Owner'}]);const model={id:'image',kind:'image' as const,enabled:true,provider:'ark',modelId:'doubao-seedream-5-0-flash-260915',apiKey:'fixture',baseUrl:'https://fixture.test'},task={projectId:project.id,phase:'samples' as const,makeVideo:false,bgm:false};
 const price=await credits.imagePricing(model.modelId),admission=await credits.admitImages('owner',model.modelId,await studio.pendingImageIds('owner',task),price.pricingHash);await withCreditUsage(credits,'owner',admission,()=>studio.generate('owner',task,{bytes,mimeType:'image/png'},model,async()=>{}));await credits.releaseImages(admission);assert.equal(calls,3);
 const folder=path.join(studio.folder('owner',project.id),'assets','pack','03');await rm(path.join(folder,'receipt.json'));await rm(path.join(folder,'still.png'));const pending=await studio.pendingImageIds('owner',task);assert.deepEqual(pending,[project.id+'_03']);assert.equal((await credits.imageQuote('owner',model.modelId,pending)).points,0);
 const retry=await credits.admitImages('owner',model.modelId,pending,price.pricingHash);await withCreditUsage(credits,'owner',retry,()=>studio.generate('owner',task,{bytes,mimeType:'image/png'},model,async()=>{}));await credits.releaseImages(retry);assert.equal(calls,3);assert.equal((await credits.snapshot('owner')).balance,1640);assert.equal((await studio.view('owner',project.id)).samples.length,3);
});
