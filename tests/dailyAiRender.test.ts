import test from 'node:test';
import assert from 'node:assert/strict';
import {copyFile,mkdir,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {dailyAiSceneHtml} from '../server/dailyAiTemplate';
import {drawingHtml,type HtmlDrawing} from '../server/narrativeScenes';
import {lessonSceneHtml} from '../server/lessonScenes';
import {inspectNewsPublicationHtml} from '../server/newsPublicationHtml';
import {newsPublicationLayoutFindings} from '../server/newsPublicationProof';
import {dimensions,createAss} from '../server/renderTimeline';
import {runFFmpeg,probeVideo} from '../server/core';
import type {EditPlan,NewsPublicationAnnotation,LessonChapter} from '../shared/types';

test('daily drawing and native scenes preserve the actual full-timeline news date safety proof',async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'daily-ai-layout-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const annotation:NewsPublicationAnnotation={referenceId:'source',publishedAt:'2026-11-15T00:00:00.000Z',publishedDateBeijing:'2026-11-15',cutoffUtc:'2026-11-15T01:00:00.000Z',windowHours:48,label:'报道日期：2026-11-15（北京时间）'};
  const drawing:HtmlDrawing={title:'核对原文，再讲机制',motion:'premium',nodes:['原文','机制','边界'].map((text,i)=>({id:'object'+i,kind:'card' as const,x:70+i*400,y:230,w:300,h:200,text,tone:'blue' as const,fontSize:32,highlight:false}))};
  const chapter:LessonChapter={id:'one',title:'核对原文，再讲机制',role:'hook',goal:'核对来源',reason:'示意',prerequisites:[],referenceIds:[],claims:[],narration:'先核对原文，再用示意解释机制。',visual:{kind:'concept',takeaway:'示意与实测分别说明',items:[{label:'原文',detail:'核对原始资料',cue:'原文'},{label:'示意',detail:'解释机制与限制',cue:'机制'}]}};
  for(const [id,html] of [['drawing',drawingHtml(drawing,3,'16:9',annotation)],['native',lessonSceneHtml(chapter,0,4,3,'16:9',{mood:'neutral',bgm:true,profile:'daily-ai'},true,undefined,annotation)]]){
    const dir=path.join(root,id);await mkdir(dir);await copyFile('node_modules/gsap/dist/gsap.min.js',path.join(dir,'gsap.min.js'));
    await writeFile(path.join(dir,'index.html'),dailyAiSceneHtml(html,'16:9'));
    const proof=await inspectNewsPublicationHtml(dir,annotation,3,'16:9');
    assert.deepEqual(newsPublicationLayoutFindings(proof.layout,'16:9',3),[]);
  }
});

test('daily subtitle layout burns onto real 1080p video and retains audio',async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'daily-ai-compositor-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const out=path.join(root,'out');await mkdir(out);
  await copyFile('skills/daily-ai-frontier/assets/sample.mp4',path.join(root,'source'));
  const plan:EditPlan={format:'16:9',summary:'图解合成检查',targetSeconds:2,clips:[{sourceId:'source',start:3,end:5}],captions:[{text:'原创示意与实测分开',start:0,end:2,style:'subtitle'}],audio:{originalVolume:1,narrationVolume:0,bgmVolume:0,normalize:false},lesson:{presentation:{profile:'daily-ai',mood:'neutral',bgm:true}} as any};
  assert.match(createAss(plan),/PlayResX: 1920/);assert.match(createAss(plan),/PlayResY: 1080/);
  assert.deepEqual(dimensions(plan),[1920,1080]);
  const ass=path.join(root,'captions.ass'),output=path.join(out,'captioned.mp4');await writeFile(ass,createAss(plan));
  const filter=ass.replaceAll('\\','/').replaceAll(':','\\:');
  await runFFmpeg(['-v','error','-y','-ss','3','-i',path.join(root,'source'),'-vf',`ass=filename='${filter}'`,'-t','2','-c:v','libx264','-threads','2','-preset','veryfast','-c:a','copy',output]);
  const probe=await probeVideo(output);assert.equal(probe.hasAudio,true);assert.ok(Math.abs(probe.duration-2)<.1);
  await runFFmpeg(['-v','error','-i',output,'-f','null','-']);
});
