import { mkdir, readFile, copyFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import ffmpeg from 'ffmpeg-static';
import type { StickerTask } from '../shared/stickerPacks';
import type { WorkflowEvent } from '../shared/types';
import { loadStickerPack, stickerAssets, stickerDirectory, validateStickerTask, verifyStickerAssets, type PackManifest } from './stickerPacks';
import { archiveTemplateProject } from './templateArchive';
import { fileDigest } from './artifactIntegrity';
import { scienceBrowser, capture } from './scienceRender';
import { runFFmpeg } from './core';
import { onJobAbort, throwIfJobCancelled } from './jobExecution';
import { currentTaskExecution } from './taskRuntime';
import { stateHash } from './durableState';
import { createToolTrace } from './toolTrace';

const safeJson = (value: unknown) => JSON.stringify(value).replace(/</g,'\\u003c');
export async function stickerVideoHtml(task: StickerTask, pack: PackManifest, assetsRoot = stickerAssets) {
  const assets: Record<string, unknown> = {};
  for(const id of task.sceneIds) {
    const item = pack.items.find(item => item.id === id)!;
    assets[id] = { src:'data:image/webp;base64,' + (await readFile(path.join(assetsRoot,'pack',id,'atlas.webp'))).toString('base64'), size:item.frameSize, durations:item.durations, name:item.name, action:item.action };
  }
  return `<!doctype html><meta charset="utf-8"><title>轻喵表情分享视频</title>
<style>body{margin:0;background:#fff9ee;color:#69473c;font-family:sans-serif;text-align:center}canvas{display:block;margin:auto;max-width:100%;max-height:85vh}button,input{margin:12px}input{width:50%}</style>
<canvas width="1080" height="1440"></canvas><button id="play">播放</button><input id="seek" type="range" min="0" max="24" step="0.01" value="0" aria-label="播放进度"><span id="time">0 / 24 秒</span>
${task.bgm ? '<audio id="music" src="music.wav" preload="metadata"></audio>' : ''}
<script>${await readFile(path.join(stickerDirectory,'renderer.js'),'utf8')}</script>
<script>const assets=${safeJson(assets)},spec=${safeJson({...task,packName:pack.name,mode:pack.mode})};
window.stickerReady=createStickerMovie(document.querySelector('canvas'),assets,spec).then(movie=>{
window.stickerMovie=movie;movie.render(0);let playing=false,t=0,last=0;
const play=document.getElementById('play'),seek=document.getElementById('seek'),clock=document.getElementById('time'),audio=document.getElementById('music');
function stop(){playing=false;play.textContent='播放';audio?.pause()}
play.onclick=()=>{if(playing){stop();return}if(t>=24)t=0;playing=true;last=performance.now();play.textContent='暂停';if(audio){audio.currentTime=t;audio.play().catch(()=>{})}};
seek.oninput=()=>{t=Number(seek.value);movie.render(t);clock.textContent=t.toFixed(1)+' / 24 秒';if(audio)audio.currentTime=t};
function tick(now){if(playing){t=Math.min(24,t+(now-last)/1000);movie.render(t);seek.value=t;clock.textContent=t.toFixed(1)+' / 24 秒';if(t>=24)stop()}last=now;requestAnimationFrame(tick)}requestAnimationFrame(tick);
});</script>`;
}
export async function renderStickerVideo(task: StickerTask, pack: PackManifest, directory: string,
  progress?: (frames:number,total:number)=>Promise<void>, assetsRoot = stickerAssets) {
  const project=path.join(directory,'video-project'), frames=path.join(directory,'frames');
  await mkdir(project,{recursive:true});await mkdir(frames,{recursive:true});
  const html=await stickerVideoHtml(task,pack,assetsRoot), file=path.join(directory,'video.mp4'),cover=path.join(directory,'cover.png');
  await writeFile(path.join(project,'index.html'),html);
  await writeFile(path.join(project,'config.json'),JSON.stringify(task,null,2));
  await copyFile(path.join(stickerDirectory,'renderer.js'),path.join(project,'renderer.js'));
  if(task.bgm)await copyFile(path.join(assetsRoot,'music.wav'),path.join(project,'music.wav'));
  const {puppeteer,executablePath}=await scienceBrowser();
  const browser=await puppeteer.launch({headless:true,executablePath,protocolTimeout:45000,args:['--disable-dev-shm-usage','--disable-background-networking',...(process.env.QINGJIAN_RENDER_NO_SANDBOX==='1'?['--no-sandbox']:[])]});
  const kill=()=>browser.process()?.kill('SIGKILL'),unbind=onJobAbort(kill),timer=setTimeout(kill,300000);
  const errors:string[]=[];
  try {
    const page=await browser.newPage();
    await page.setRequestInterception(true);page.on('request',(q:any)=>void(q.url().startsWith('data:')?q.continue():q.abort()));
    page.on('pageerror',(e:Error)=>errors.push(e.message));
    await page.setContent(html,{waitUntil:'domcontentloaded'});
    await page.evaluate(()=>Promise.all([(window as any).stickerReady,document.fonts.ready]));
    for(let frame=0;frame<720;frame++) {
      throwIfJobCancelled();
      const jpeg=await page.evaluate((t:number)=>{(window as any).stickerMovie.render(t);return document.querySelector('canvas')!.toDataURL('image/jpeg',.97).split(',')[1];},frame/30);
      await writeFile(path.join(frames,`frame-${String(frame).padStart(4,'0')}.jpg`),Buffer.from(jpeg,'base64'));
      if(frame===675) {
        const png=await page.evaluate(()=>document.querySelector('canvas')!.toDataURL('image/png').split(',')[1]);
        await writeFile(cover,Buffer.from(png,'base64'));
      }
      if(frame%30===0)await progress?.(frame,720);
    }
    if(errors.length)throw new Error('表情动画执行失败：'+errors.join(';'));
  } catch(error) {
    await rm(frames,{recursive:true,force:true});throw error;
  } finally {
    clearTimeout(timer);unbind();const closing=setTimeout(kill,1500);
    try{await browser.close();}finally{clearTimeout(closing);}
  }
  try {
    await runFFmpeg(['-nostdin','-hide_banner','-loglevel','error','-framerate','30','-i',path.join(frames,'frame-%04d.jpg'),
      ...(task.bgm?['-i',path.join(assetsRoot,'music.wav')]:[]),'-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p',
      ...(task.bgm?['-c:a','aac','-b:a','192k']:['-an']),'-t','24','-movflags','+faststart',file],180000);
  } finally {await rm(frames,{recursive:true,force:true});}
  const probe=createRequire(import.meta.url)('ffprobe-static').path;
  const {streams}=JSON.parse((await capture(probe,['-v','error','-count_frames','-show_streams','-of','json',file])).toString());
  const video=streams.find((s:any)=>s.codec_type==='video'),audio=streams.some((s:any)=>s.codec_type==='audio');
  if(!video||video.width!==1080||video.height!==1440||Number(video.nb_read_frames)!==720||
     video.avg_frame_rate!=='30/1'||Math.abs(Number(video.duration)-24)>.04||audio!==task.bgm)throw new Error('表情分享视频的画幅、时长、帧数或音轨未通过检查。');
  await runFFmpeg(['-v','error','-i',file,'-f','null','-'],60000);
  const contactSheet=path.join(project,'scenes.jpg');
  await runFFmpeg(['-v','error','-i',file,'-vf','fps=1/3.6,scale=270:360,tile=4x2','-frames:v','1',contactSheet],60000);
  await copyFile(cover,path.join(project,'cover-portrait.png'));
  await runFFmpeg(['-v','error','-i',cover,'-vf','scale=810:1080,pad=1440:1080:315:0:color=0xfff5e7','-frames:v','1',path.join(project,'cover-landscape.png')],60000);
  const verification={technicalPassed:true,userAccepted:false,width:1080,height:1440,fps:30,decodedFrames:720,duration:24,hasBgm:audio,videoSha256:await fileDigest(file),sourceHash:stateHash({task,files:task.sceneIds.map(id=>pack.files[`pack/${id}/atlas.webp`])}),fullDecode:true};
  await writeFile(path.join(project,'verification.json'),JSON.stringify(verification,null,2));
  const archive=path.join(directory,'video-project.zip');await archiveTemplateProject(project,archive);
  return {file,cover,archive,project,verification};
}
export async function runStickerWorkflow(o:{pack?:PackManifest;assetsRoot?:string;task:StickerTask;directory:string;progress:(events:WorkflowEvent[])=>Promise<void>;renderProgress?:(frames:number,total:number)=>Promise<void>}) {
  await mkdir(o.directory,{recursive:true});
  const trace=createToolTrace(o.progress),pack=o.pack || await loadStickerPack(),assetsRoot=o.assetsRoot || stickerAssets,task=validateStickerTask(o.task,pack);
  const sourceHash=await trace.run('verify_sticker_pack','核对24套表情与透明序列帧',{pack:pack.id},()=>verifyStickerAssets(pack,assetsRoot));
  const bundle=path.join(o.directory,'sticker-pack');await mkdir(bundle,{recursive:true});
  const archive=await trace.run('package_stickers','保存表情套装与专辑配套素材',{count:24,formats:['GIF','WebP','APNG','PNG']},async()=>{
    for(const item of pack.items) {
      throwIfJobCancelled();const folder=path.join(bundle,item.name);await mkdir(folder);
      for(const [file,target] of (pack.mode === 'static' ? [['still.png','静态.png']] : [['animation.gif','动画.gif'],['animation.webp','动画.webp'],['animation.png','动画-APNG.png'],['still.png','静态.png']]))await copyFile(path.join(assetsRoot,'pack',item.id,file),path.join(folder,target));
    }
    for(const file of ['banner.jpg','album.png','icon.png','album.json'])await copyFile(path.join(assetsRoot,file),path.join(bundle,file));
    await writeFile(path.join(bundle,'清单.json'),JSON.stringify({id:pack.id,version:pack.version,sourceHash,items:pack.items},null,2));
    const file=path.join(o.directory,'stickers.zip');await archiveTemplateProject(bundle,file);return file;
  });
  const rendered=task.makeVideo?await trace.run('render_sticker_story','使用同一批表情制作分享视频',{title:task.title,sceneIds:task.sceneIds,bgm:task.bgm},()=>renderStickerVideo(task,pack,o.directory,o.renderProgress,assetsRoot)):undefined;
  const verification={technicalPassed:true,approved:true,sourceHash,count:pack.items.length,task,video:rendered?.verification,packSha256:await fileDigest(archive)};
  const projectHash=stateHash(verification),execution=currentTaskExecution();
  await execution?.verify('technical',projectHash,verification);
  await execution?.verify('requirements',projectHash,{approved:true,basis:'validated structured form and curated asset hashes',task,sourceHash});
  await execution?.accept({projectHash,artifactHash:verification.packSha256,technicalPassed:true,requirementsReviewed:true});
  await writeFile(path.join(o.directory,'delivery.json'),JSON.stringify(verification,null,2));
  throwIfJobCancelled();return {pack,task,sourceHash,archive,rendered,verification};
}
