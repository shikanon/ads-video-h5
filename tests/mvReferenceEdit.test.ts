import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {PNG} from 'pngjs';
import {validateMvPlan,mvPlanHash,fitMvTiming,renderMv} from '../server/mvRecreation';
import {referencePictureHash} from '../server/mvReferenceEdit';
import {runFFmpeg} from '../server/core';
import {fileDigest} from '../server/artifactIntegrity';
const edit={version:1,canvas:[320,240],picture:{width:320,height:136,x:0,y:52},dissolveFrames:12,fadeInFrames:0,fadeOutFrames:0,audioFadeOutFrames:0};
const treatment={speed:1,grade:'cool',crops:[{x:0,y:32,width:320,height:136}]};
function fixture(){const p:any={id:'p',ownerId:'a',referenceId:'ref',audioId:'audio',sourceIds:['blue','red'],duration:3},media:any[]=['blue','red','ref'].map(id=>({id,ownerId:'a',kind:'video',duration:4}));media.push({id:'audio',ownerId:'a',kind:'audio',duration:3});const plan:any={story:'保留原画幅',referenceEdit:edit,shots:[{sourceId:'blue',start:0,duration:1,transition:'cut'},{sourceId:'red',start:0,duration:1,transition:'fade'},{sourceId:'blue',start:1,duration:1,transition:'cut'}].map(s=>({...s,treatment,chapter:'原切点',reason:'原工程参数'})),captions:[],limitations:[]};return {p,media,plan};}
test('source edits preserve centered cut timing, bounded source transforms and owned derivatives',()=>{
 const {p,media,plan}=fixture();assert.equal(validateMvPlan(plan,p,media).shots.length,3);assert.deepEqual(fitMvTiming(plan,p,media).referenceEdit,edit);
 assert.throws(()=>fitMvTiming(plan,{...p,duration:3.2},media),/名义时长/);
 assert.throws(()=>validateMvPlan({...plan,referenceEdit:{...edit,picture:{...edit.picture,width:322}}},p,media),/画幅/);
 const short=structuredClone(plan);short.shots[0].start=3;assert.throws(()=>validateMvPlan(short,p,media),/时长/);
 const invalid=structuredClone(plan);invalid.shots[0].treatment.speed='1;movie=reference';assert.throws(()=>validateMvPlan(invalid,p,media),/参数/);
 assert.throws(()=>validateMvPlan({...plan,referenceEdit:{...edit,titleTrackId:'ref'}},p,media),/透明轨/);
 const h=referencePictureHash({...p,plan},plan);assert.equal(referencePictureHash({...p,plan:{...plan,captions:[{start:0,end:1,text:'字幕'}]}},{...plan,captions:[{start:0,end:1,text:'字幕'}]}),h);
 assert.notEqual(referencePictureHash(p,{...plan,referenceEdit:{...edit,picture:{...edit.picture,y:50}}} as any),h);
});
test('real original-edit rendering keeps the picture full width and centered dissolve frame count, with reusable nodes',{timeout:120000},async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'mv-source-edit-'));t.after(()=>rm(dir,{recursive:true,force:true}));const {p,media,plan}=fixture();const files:Record<string,string>={};
 for(const color of ['blue','red']){files[color]=path.join(dir,color+'.mp4');await runFFmpeg(['-v','error','-y','-f','lavfi','-i',`color=c=${color}:s=320x200:r=30:d=4`,'-c:v','libx264','-threads','1','-pix_fmt','yuv420p',files[color]]);}
 files.audio=path.join(dir,'audio.wav');await runFFmpeg(['-v','error','-y','-f','lavfi','-i','sine=duration=3','-c:a','pcm_s16le',files.audio]);files.ref=files.blue;
 p.evidence={};for(const m of media)p.evidence[m.id]={sha256:await fileDigest(files[m.id]),description:'fixture'};p.plan=validateMvPlan(plan,p,media);p.planHash=mvPlanHash(p.plan);p.approvedHash=p.planHash;
 const opts={project:p,media,file:async(id:string)=>files[id],directory:dir,preview:false,progress:async()=>{}};const result=await renderMv(opts);assert.equal(result.receipt.duration,3);assert.equal(result.receipt.width,320);
 const node=path.join(path.dirname(result.file),'clip-0.mp4'),mtime=(await stat(node)).mtimeMs;
 const sample=async(time:number)=>{const f=path.join(dir,'frame-'+time+'.png');await runFFmpeg(['-v','error','-y','-ss',String(time),'-i',result.file,'-frames:v','1',f]);return PNG.sync.read(await readFile(f));};
 const first=await sample(.5),middle=await sample(1),after=await sample(1.5);const pixel=(im:PNG,x:number,y:number,c:number)=>im.data[(y*320+x)*4+c];
 assert.ok(pixel(first,1,70,2)>150,'Picture touches original left edge');assert.ok(pixel(first,315,70,2)>150,'Picture touches original right edge');assert.ok(pixel(first,160,20,2)<25,'Only original top border');assert.ok(pixel(after,160,100,0)>150,'Second shot follows original edit');assert.ok(pixel(middle,160,100,0)>35&&pixel(middle,160,100,2)>35,'Dissolve is centered at nominal cut');
 p.plan.captions=[{start:.2,end:.8,text:'歌词',kind:'lyric'}];p.planHash=mvPlanHash(p.plan);p.approvedHash=p.planHash;const changed=await renderMv(opts);assert.notEqual(changed.file,result.file);assert.equal((await stat(node)).mtimeMs,mtime);assert.equal(changed.receipt.lyricCaptions,1);
});
