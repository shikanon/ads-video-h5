import test from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import { once } from 'node:events';
import type { AppSettings, AppState, EditPlan, MediaItem } from '../src/types';
import { compileSpriteSheet, opaqueFrameDifference, readAvatarPng, spriteFrames, validateAvatarTracks } from '../server/avatarAssets';
import { mountAvatarRoutes } from '../server/avatarRoutes';
import { renderAvatar } from '../server/renderAvatar';
import { runFFmpeg, probeVideo, validatePlan, imageClipsAllowed } from '../server/core';
import { sessionSources } from '../server/sourceSelection';
import { excludesAvatar, planAuthorAvatar } from '../server/avatarWorkflow';
import { renderTimeline } from '../server/renderTimeline';

function fixture(identical=false,opaque=false) {
  const png=new PNG({width:131,height:131});
  const colors=[[240,25,25],[25,240,25],[25,25,240],[220,170,25]];
  for(let n=0;n<4;n++){
    const color=colors[identical?0:n],x=Math.floor(n%2*131/2),y=Math.floor(Math.floor(n/2)*131/2);
    for(let yy=10;yy<50;yy++)for(let xx=10;xx<50;xx++)png.data.set([...color,255],((y+yy)*131+x+xx)*4);
  }
  if(opaque)for(let i=3;i<png.data.length;i+=4)png.data[i]=255;
  return PNG.sync.write(png);
}
const input={columns:2,rows:2,frameCount:4,fps:4};
function asset():MediaItem {const s=compileSpriteSheet(fixture(),input);return {id:'sprite',ownerId:'a',kind:'image',name:'Author',mimeType:'image/png',url:'/api/media/sprite',createdAt:'2026-10-03',character:{role:'sprite',sprite:s.sprite}};}
const basePlan=():EditPlan=>({format:'16:9',targetSeconds:2,summary:'test',clips:[{sourceId:'background',start:0,end:2}]});
function track(item:MediaItem){return {mediaId:item.id,assetHash:item.character!.sprite!.sha256,start:.2,end:1.7,fps:4,layout:'corner' as const,position:'right' as const,size:.22,reason:'test'};}

test('fractional sprite grids preserve alpha and produce independent, aligned frames',()=>{
  const result=compileSpriteSheet(fixture(),input),frames=spriteFrames(result.bytes,result.sprite);
  assert.equal(frames.length,4);assert.equal(new Set(result.sprite.frameHashes).size,4);
  assert.equal(result.sprite.frameWidth,82);assert.equal(result.sprite.frameHeight,82);
  for(let n=0;n<4;n++){
    const image=PNG.sync.read(frames[n]);assert.equal(image.data[3],0);
    assert.equal(image.data[(25*image.width+25)*4+3],255);
  }
});
test('invalid sheets cannot be registered as working animation',()=>{
  assert.throws(()=>compileSpriteSheet(fixture(true),input),/全部相同/);
  assert.throws(()=>compileSpriteSheet(fixture(false,true),input),/透明/);
  assert.throws(()=>compileSpriteSheet(fixture(),{...input,frameCount:5}),/格数/);
  assert.throws(()=>compileSpriteSheet(fixture(),{...input,fps:0}),/帧率/);
  const malformed=fixture();malformed.writeUInt32BE(20000,16);assert.throws(()=>readAvatarPng(malformed),/尺寸/);
  const valid=compileSpriteSheet(fixture(),input);assert.throws(()=>spriteFrames(fixture(),valid.sprite),/版本不一致/);
});
test('coverage check distinguishes a rendered actor from the background after it disappears',()=>{
  const compiled=compileSpriteSheet(fixture(),input),expected=PNG.sync.read(compiled.frames[0]);
  const background=new PNG({width:expected.width,height:expected.height});
  for(let i=0;i<background.data.length;i+=4)background.data.set([85,85,85,255],i);
  assert.equal(opaqueFrameDifference(expected,expected),0);
  assert.ok(opaqueFrameDifference(expected,background)>35);
});
test('an explicit removal is stored in the plan and later exports keep the author disabled',async()=>{
  const item=asset(),plan={...basePlan(),avatars:[track(item)]};
  const config={id:'not-called',name:'not-called',provider:'ark',kind:'text' as const,modelId:'not-called',apiKey:'not-called',baseUrl:'https://example.test',enabled:true};
  await planAuthorAvatar(plan,item,[item],'去掉作者形象',config,async()=>{});
  assert.deepEqual(plan.avatars,[]);assert.equal(plan.authorAvatarMode,'off');
  await planAuthorAvatar(plan,item,[item],'生成成片',config,async()=>{});
  assert.deepEqual(plan.avatars,[]);assert.equal(plan.authorAvatarMode,'off');
});
test('avatars stay separate from source clips, and track IDs and timecodes are validated',()=>{
  const item=asset(),background:MediaItem={id:'background',name:'Background',mimeType:'video/mp4',kind:'video',duration:2,createdAt:'2026-10-03',url:'/api/media/background'};
  assert.deepEqual(sessionSources('全部素材',[item,background],[item],null,[]),[background]);
  assert.throws(()=>validatePlan({...basePlan(),clips:[{sourceId:item.id,start:0,end:2}]},[item],true),/不存在/);
  assert.throws(()=>validateAvatarTracks([track(item)],basePlan(),[]),/不存在/);
  assert.throws(()=>validateAvatarTracks([{...track(item),end:3}],basePlan(),[item]),/时间范围/);
  assert.throws(()=>validateAvatarTracks([{...track(item),assetHash:'changed'}],basePlan(),[item]),/版本/);
  assert.equal(excludesAvatar('不要作者形象，保留原视频'),true);
  assert.equal(excludesAvatar('用我的作者形象生成视频'),false);
});
test('re-export keeps the previously authorized image clip without admitting an author sheet as footage',()=>{
  const background:MediaItem={id:'background',kind:'image',mimeType:'image/png',name:'Background',url:'/api/media/background',createdAt:'2026-10-03'};
  assert.equal(imageClipsAllowed('重新导出，作者保留到最后一帧',[background],basePlan()),true);
  assert.equal(imageClipsAllowed('只使用视频，不使用图片',[background],basePlan()),false);
  assert.equal(imageClipsAllowed('重新导出',[asset()],{...basePlan(),clips:[{sourceId:'sprite',start:0,end:2}]}),false);
});
test('actual FFmpeg export plays distinct frames, retains transparency and sound, and respects start/end', {timeout:30000}, async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'qingjian-avatar-render-'));
  try{
    const item=asset(),compiled=compileSpriteSheet(fixture(),input);await writeFile(path.join(dir,item.id),compiled.bytes);
    const base=path.join(dir,'base.mp4');
    await runFFmpeg(['-v','error','-y','-f','lavfi','-i','color=c=0x555555:s=960x540:r=30:d=2','-f','lavfi','-i','sine=frequency=440:duration=2','-c:v','libx264','-threads','2','-pix_fmt','yuv420p','-c:a','aac','-shortest',base]);
    const plan={...basePlan(),avatars:[track(item)]},rendered=await renderAvatar(base,plan,[item],dir,dir,960,540);
    assert.equal((await probeVideo(rendered.file)).hasAudio,true);
    assert.equal(rendered.records[0].frameCount,4);
    const rec=rendered.records[0],samples:number[][]=[];
    for(const [i,time] of [.05,.27,.52,.77,1.27,1.87].entries()){
      const frame=path.join(dir,`sample-${i}.png`);await runFFmpeg(['-v','error','-y','-ss',String(time),'-i',rendered.file,'-frames:v','1',frame]);
      const image=PNG.sync.read(await readFile(frame)),p=((rec.y+Math.round(rec.height*.35))*image.width+rec.x+Math.round(rec.width*.35))*4;
      samples.push([...image.data.subarray(p,p+3)]);
      const alphaEdge=((rec.y+1)*image.width+rec.x+1)*4;assert.ok(image.data[alphaEdge]>60&&image.data[alphaEdge]<110,'transparent edges keep the background');
    }
    assert.ok(samples[1][0]>170&&samples[1][1]<75,'first frame is red: '+JSON.stringify(samples));
    assert.ok(samples[2][1]>170&&samples[2][0]<75,'second frame is green');
    assert.ok(samples[3][2]>170&&samples[3][0]<75,'third frame is blue');
    assert.ok(samples[4][0]>170&&samples[4][1]<75,'the sequence loops back to its first red frame');
    for(const i of [0,5])assert.ok(samples[i].every(v=>v>60&&v<110),'animation is hidden outside its track');
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('avatar import and default selection enforce ownership and read current media after deletion',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'qingjian-avatar-api-'));let media:MediaItem[]=[asset()];
  const settings:AppSettings={defaultModelId:null,language:'zh-CN',chatBackground:null};
  const app=express();app.use(express.json());app.use((request,_response,next)=>{Object.assign(request,{user:{id:'a',email:'a@example.test',displayName:'a'}});next();});
  await mkdir(path.join(dir,'tmp'));
  mountAvatarRoutes(app,{media:()=>media,mediaDir:dir,tmpDir:path.join(dir,'tmp'),settings:async()=>settings,save:async()=>{},session:()=>undefined,generate:()=>{throw new Error('not used');},process:()=>{},publicState:async()=>({media,settings}) as AppState});
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address==='object');const base=`http://127.0.0.1:${address.port}`;
  try{
    const select=(id:string)=>fetch(base+'/api/avatars/active',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mediaId:id})});
    assert.equal((await select('sprite')).status,200);media=[];assert.equal((await select('sprite')).status,400);
    media=[{...asset(),ownerId:'b'}];assert.equal((await select('sprite')).status,400);
    const form=new FormData();form.append('file',new Blob([fixture()],{type:'image/png'}),'sheet.png');form.append('role','sprite');for(const [k,v] of Object.entries(input))form.append(k,String(v));form.append('referenceMediaId','foreign-reference');
    assert.equal((await fetch(base+'/api/avatars',{method:'POST',body:form})).status,400);
    form.delete('referenceMediaId');assert.equal((await fetch(base+'/api/avatars',{method:'POST',body:form})).status,201);assert.equal(media.at(-1)?.ownerId,'a');
  }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(dir,{recursive:true,force:true});}
});
test('image-clip concat timestamps cannot hide the author near the end of the exported timeline',{timeout:30000},async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'qingjian-avatar-end-'));
  try{
    const item=asset(),compiled=compileSpriteSheet(fixture(),input);
    const gray=new PNG({width:96,height:96});for(let i=0;i<gray.data.length;i+=4)gray.data.set([85,85,85,255],i);
    await writeFile(path.join(dir,'background'),PNG.sync.write(gray));await writeFile(path.join(dir,item.id),compiled.bytes);
    const background:MediaItem={id:'background',kind:'image',mimeType:'image/png',name:'Background',url:'/api/media/background',createdAt:'2026-10-03'};
    const plan:EditPlan={...basePlan(),avatars:[{...track(item),start:0,end:2}]};
    const output=await renderTimeline(plan,[item,background],dir,dir);
    const frame=path.join(dir,'last.png');await runFFmpeg(['-v','error','-y','-ss','1.9','-i',output.file,'-frames:v','1',frame]);
    const image=PNG.sync.read(await readFile(frame));const manifest=JSON.parse(await readFile(output.file.replace('.mp4','.render.json'),'utf8')),r=manifest.avatars[0];
    const p=((r.y+Math.round(r.height*.35))*image.width+r.x+Math.round(r.width*.35))*4;
    const color=[...image.data.subarray(p,p+3)];assert.ok(Math.max(...color)-Math.min(...color)>80,'the final animation frame is present, not just the gray background');
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('a full-duration sidebar keeps the author in every tail frame of a fractional-length video',{timeout:30000},async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'qingjian-avatar-tail-'));
  try{
    const item=asset(),compiled=compileSpriteSheet(fixture(),input);await writeFile(path.join(dir,item.id),compiled.bytes);
    const base=path.join(dir,'base.mp4');
    await runFFmpeg(['-v','error','-y','-f','lavfi','-i','color=c=0x555555:s=960x540:r=30:d=20.1','-f','lavfi','-i','anullsrc=r=44100:cl=stereo','-t','20.1','-c:v','libx264','-threads','2','-pix_fmt','yuv420p','-c:a','aac',base]);
    const plan:EditPlan={...basePlan(),targetSeconds:20.1,avatars:[{...track(item),start:0,end:20.1,fps:6,layout:'sidebar'}]};
    const rendered=await renderAvatar(base,plan,[item],dir,dir,960,540),r=rendered.records[0];
    await runFFmpeg(['-v','error','-y','-ss','19.8','-i',rendered.file,'-frames:v','9','-vf',`crop=${r.width}:${r.height}:${r.x}:${r.y}`,path.join(dir,'tail-%02d.png')]);
    for(let i=1;i<=9;i++){
      const image=PNG.sync.read(await readFile(path.join(dir,`tail-${String(i).padStart(2,'0')}.png`)));
      const p=(Math.round(image.height*.35)*image.width+Math.round(image.width*.35))*4,color=[...image.data.subarray(p,p+3)];
      assert.ok(Math.max(...color)-Math.min(...color)>80,`tail frame ${i} must contain the colored author, not the sidebar background`);
    }
  }finally{await rm(dir,{recursive:true,force:true});}
});
