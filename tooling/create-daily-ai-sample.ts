// Original neutral template sample; no current-news claims or paid model calls.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { scienceBrowser } from '../server/scienceRender';
import { drawingHtml, type HtmlDrawing } from '../server/narrativeScenes';
import { dailyAiSceneHtml } from '../server/dailyAiTemplate';
import { writePresetBgm } from '../server/bgm';
import { runFFmpeg } from '../server/core';
const output=path.resolve('skills/daily-ai-frontier/assets'),frames=path.resolve('D:/ads-video-h5-diagnostics/daily-ai-sample/frames');
await mkdir(output,{recursive:true});await mkdir(frames,{recursive:true});
const drawing:HtmlDrawing={title:'把一个AI问题，讲清楚',motion:'premium',nodes:[
  {id:'question',kind:'card',x:70,y:220,w:240,h:180,text:'一个问题\n先展示结果',tone:'blue',fontSize:30,highlight:true},
  {id:'source',kind:'card',x:370,y:220,w:240,h:180,text:'读原文\n核对日期来源',tone:'paper',fontSize:28,highlight:true},
  {id:'mechanism',kind:'card',x:670,y:220,w:240,h:180,text:'画机制\n让变化看得见',tone:'coral',fontSize:32,highlight:true},
  {id:'boundary',kind:'card',x:970,y:220,w:240,h:180,text:'讲边界\n示意≠实测',tone:'paper',fontSize:30,highlight:true},
  {id:'link1',kind:'line',x:315,y:310,w:50,h:0,text:'',tone:'blue',fontSize:24,highlight:false},
  {id:'link2',kind:'line',x:615,y:310,w:50,h:0,text:'',tone:'coral',fontSize:24,highlight:false},
  {id:'link3',kind:'line',x:915,y:310,w:50,h:0,text:'',tone:'blue',fontSize:24,highlight:false},
  {id:'note',kind:'text',x:180,y:460,w:920,h:60,text:'模型与工具 / 机器人 / 科学 / 创作',tone:'ink',fontSize:32,highlight:false},
]};
let html=dailyAiSceneHtml(drawingHtml(drawing,35,'16:9'),'16:9');
html=html.replace('<script src="./gsap.min.js"></script>','<script>'+await readFile('node_modules/gsap/dist/gsap.min.js','utf8')+'</script>');
html=html.replace('</style>','.sample-orb{position:absolute;width:18px;height:18px;left:320px;top:430px;border-radius:50%;background:#C2185B}.sample-caption{position:absolute;z-index:3;left:70px;right:70px;top:620px;text-align:center;color:#6B21A8;font-size:30px;font-weight:600}</style>');
html=html.replace('</section>','<div class="sample-orb"></div><div class="sample-caption">原创视觉样片 · 无旁白示意</div></section>');
html=html.replace('window.__timelines.main=tl;',"tl.to('.sample-orb',{x:600,duration:34,ease:'sine.inOut'},0);window.__timelines.main=tl;");
const {puppeteer,executablePath}=await scienceBrowser();const browser=await puppeteer.launch({headless:true,executablePath,args:['--disable-dev-shm-usage']});
try{const page=await browser.newPage();page.on('pageerror',error=>console.error(error));await page.setViewport({width:1280,height:720});await page.setContent(html);await page.evaluate(async()=>{await document.fonts.ready;return true;});console.log('Ready to render');
for(let n=0;n<1050;n++){await page.evaluate(t=>{window.__timelines.main.seek(t,false);},n/30);await page.screenshot({path:path.join(frames,`frame-${String(n).padStart(4,'0')}.jpg`),type:'jpeg',quality:90});if(n===105)await page.screenshot({path:path.join(output,'poster.png')});}
}finally{await browser.close();}
const music=path.join(frames,'music.wav');await writePresetBgm(music);
await runFFmpeg(['-y','-v','error','-framerate','30','-i',path.join(frames,'frame-%04d.jpg'),'-stream_loop','-1','-i',music,'-vf','scale=1920:1080','-c:v','libx264','-preset','fast','-crf','21','-pix_fmt','yuv420p','-c:a','aac','-b:a','128k','-t','35','-movflags','+faststart',path.join(output,'sample.mp4')]);
console.log('Created original 35s sample and poster. No publication or model calls.');
