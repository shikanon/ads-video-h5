import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {PNG} from 'pngjs';
import {createMvAss,validateMvCaption} from '../server/mvSubtitles';
import {lyricCaptions} from '../server/mvLyrics';
import {validateMvPlan,mvPlanHash,renderMv} from '../server/mvRecreation';
import {runFFmpeg} from '../server/core';
import {fileDigest} from '../server/artifactIntegrity';
import {capturePage,waitFor} from './fixtures/nativeClient';

test('MV lyrics preserve actual words and timing, split readable lines and reject fabricated word-to-line matches',()=>{
 const words=Array.from({length:20},(_,i)=>({start:i,end:i+.5,text:'字'}));const captions=lyricCaptions([{words}]);assert.equal(captions.length,2);assert.equal(captions.map(c=>c.text).join(''),'字'.repeat(20));assert.deepEqual(captions.flatMap(c=>c.words||[]),words);assert.deepEqual(lyricCaptions([{words:[]}]),[]);for(const c of captions)validateMvCaption(c,20);
 assert.throws(()=>validateMvCaption({...captions[0],text:'补写的文字'},20),/不一致/);assert.throws(()=>validateMvCaption({start:0,end:2,text:'歌词',kind:'lyric',words:[{start:1,end:2,text:'歌'},{start:.5,end:1,text:'词'}]},2),/顺序/);
 const ass=createMvAss({story:'测试',shots:[],limitations:[],subtitleStyle:'cinematic',captions:[{start:0,end:2,text:'剧情',kind:'story'},captions[0]]},1920,1080,20);assert.match(ass,/Ma Shan Zheng/);assert.match(ass,/\\pos\(960,969\)/);assert.match(ass,/\\pos\(960,1035\)/);assert.match(ass,/\\fad\(220,260\)/);assert.match(ass,/\\kf50/);
});

test('actual MV frames keep two subtitle lines in black margins and reuse picture nodes after subtitle edits',{timeout:120000},async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'mv-subtitles-'));t.after(()=>rm(dir,{recursive:true,force:true}));const video=path.join(dir,'source.mp4'),audio=path.join(dir,'audio.wav');
 await runFFmpeg(['-v','error','-y','-f','lavfi','-i','color=c=blue:s=320x180:d=2:r=30','-c:v','libx264','-threads','1','-pix_fmt','yuv420p',video]);await runFFmpeg(['-v','error','-y','-f','lavfi','-i','sine=duration=2','-c:a','pcm_s16le',audio]);
 const media:any[]=[{id:'ref',ownerId:'a',kind:'video',duration:2},{id:'source',ownerId:'a',kind:'video',duration:2},{id:'song',ownerId:'a',kind:'audio',duration:2}],file=async(id:string)=>id==='song'?audio:video;
 const p:any={ownerId:'a',referenceId:'ref',audioId:'song',sourceIds:['source'],duration:2,evidence:{}};for(const m of media)p.evidence[m.id]={sha256:await fileDigest(await file(m.id)),description:'fixture'};
 p.plan=validateMvPlan({story:'字幕层验收',subtitleStyle:'cinematic',shots:[{sourceId:'source',start:0,duration:2,chapter:'测试',reason:'完整蓝色原素材',transition:'cut'}],captions:[{kind:'story',start:.2,end:1.8,text:'剧情字幕'},{kind:'lyric',start:.2,end:1.8,text:'演唱歌词',words:[{start:.2,end:.6,text:'演唱'},{start:.6,end:1.8,text:'歌词'}]}],limitations:[]},p,media);p.planHash=mvPlanHash(p.plan);p.approvedHash=p.planHash;
 const opts={project:p,media,file,directory:dir,preview:false,dimensions:[640,360] as [number,number],progress:async()=>{}};const result=await renderMv(opts),node=path.join(path.dirname(result.file),'clip-0.mp4'),mtime=(await stat(node)).mtimeMs;
 const png=path.join(dir,'caption-frame.png');await runFFmpeg(['-v','error','-y','-ss','1','-i',result.file,'-frames:v','1',png]);const im=PNG.sync.read(await readFile(png));
 const bright=(low:number,high:number)=>{let n=0;for(let y=low;y<high;y++)for(let x=100;x<540;x++){const i=(y*im.width+x)*4;if(im.data[i]>110&&im.data[i+1]>110&&im.data[i+2]>50)n++;}return n;};assert.ok(bright(315,334)>15,'Story must be visible in the first margin row');assert.ok(bright(337,355)>15,'Lyrics must be visible in the second margin row');assert.ok(im.data[(180*640+320)*4+2]>180,'Original picture remains blue');assert.ok(im.data[(320*640+20)*4+2]<20,'Caption margin is black');
 p.plan.captions[0].text='修改后的剧情';p.planHash=mvPlanHash(p.plan);p.approvedHash=p.planHash;const changed=await renderMv(opts);assert.notEqual(changed.file,result.file);assert.equal((await stat(node)).mtimeMs,mtime);assert.equal(changed.receipt.lyricCaptions,1);assert.equal(changed.receipt.storyCaptions,1);assert.equal(changed.receipt.userAccepted,false);
});

test('native lyric review edits words without inventing karaoke times, keeps story text and clears account drafts',async()=>{
 const calls:any[]=[],project:any={id:'p',name:'测试',duration:2,sourceIds:[],planHash:'h',plan:{story:'叙事',shots:[],limitations:[],captions:[{start:0,end:1,text:'剧情'}]},lyricDraft:{captions:[{kind:'lyric',start:0,end:1,text:'原词',words:[{start:0,end:1,text:'原词'}]}]}};
 const app:any={_generation:1,state:{media:[],jobs:[]},client:{hasSession:()=>true,request:async(url:string,body:any,method:string)=>{calls.push({url,body,method});return {projects:[project]};}},subscribe:()=>()=>{},refresh:async()=>{}};
 const page=await capturePage('mv-recreate',app,{});page.onLoad({projectId:'p'});page.onShow();await waitFor(()=>Boolean(page.data.project));page.toggleLyrics();page.editLyric({currentTarget:{dataset:{index:0,field:'text'}},detail:{value:'校对词'}});assert.equal(page.data.lyricRows[0].words,undefined);await page.useLyrics();const patch=calls.find(c=>c.method==='PATCH');assert.equal(patch.body.expectedHash,'h');assert.deepEqual(patch.body.plan.captions.map((c:any)=>c.text),['剧情','校对词']);assert.equal(patch.body.plan.subtitleStyle,'cinematic');app._generation++;page.onShow();assert.equal(page.data.lyricRows.length,0);assert.equal(page.data.showLyrics,false);page.onHide();
});
