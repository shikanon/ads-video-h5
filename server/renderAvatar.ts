import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { EditPlan, MediaItem } from '../src/types';
import { spriteFrames } from './avatarAssets';
import { runFFmpeg } from './core';

export interface AvatarRenderRecord {
  mediaId: string; assetHash: string; frameCount: number; frameHashes: string[];
  fps: number; loopSeconds: number; start: number; end: number;
  layout: string; x: number; y: number; width: number; height: number;
  transparency: string; engine: 'png-sequence/ffmpeg';
}
export async function renderAvatar(input:string, plan:EditPlan, media:MediaItem[], mediaDir:string, tempDir:string, width:number, height:number) {
  const track=plan.avatars?.[0]; if(!track)return {file:input,records:[] as AvatarRenderRecord[]};
  const item=media.find(m=>m.id===track.mediaId),sprite=item?.character?.sprite;
  if(!sprite)throw new Error('作者形象动画资产不存在。');
  const frames=spriteFrames(await readFile(path.join(mediaDir,item.id)),sprite);
  await Promise.all(frames.map((bytes,i)=>writeFile(path.join(tempDir,`avatar-${String(i).padStart(2,'0')}.png`),bytes,{mode:0o600})));
  const avatarWidth=Math.round(width*track.size/2)*2,avatarHeight=Math.round(avatarWidth*sprite.frameHeight/sprite.frameWidth/2)*2;
  const x=track.position==='right'?width-avatarWidth-16:16;
  const y=Math.max(16,Math.round(height*.76-avatarHeight));
  const sidebar=track.layout==='sidebar';
  const mainWidth=sidebar?Math.round(width*(1-track.size-.025)/2)*2:width;
  const mainHeight=sidebar?Math.round(height*mainWidth/width/2)*2:height;
  const mainX=sidebar&&track.position==='left'?width-mainWidth:0;
  const firstFrame=Math.ceil(track.start*30),endFrame=Math.ceil(track.end*30);
  // The output duration already trims a full-length layer. Avoid a second
  // end-of-stream switch, which can blank a boundary frame before CFR muxing.
  const gates=[...(firstFrame>0?[`gt(n,${firstFrame})`]:[]),...(track.end<plan.targetSeconds-.001?[`lte(n,${endFrame})`]:[])];
  const filters=[`[0:v]${sidebar?`scale=${mainWidth}:${mainHeight},pad=${width}:${height}:${mainX}:(oh-ih)/2:color=0xfffdfa,`:''}setsar=1,fps=30,settb=AVTB,setpts=N/(30*TB)[main]`,
    `[1:v]format=rgba,scale=${avatarWidth}:${avatarHeight}:flags=lanczos,loop=loop=-1:size=${frames.length}:start=0,settb=AVTB,setpts=N/(${track.fps}*TB)${track.start?`+${track.start}/TB`:''}[avatar]`,
    `[main][avatar]overlay=x=${x}:y=${y}${gates.length?`:enable='${gates.join('*')}'`:''}:format=auto[v]`];
  const output=path.join(tempDir,'with-author-avatar.mp4');
  await runFFmpeg(['-v','error','-y','-i',input,'-framerate',String(track.fps),'-i',path.join(tempDir,'avatar-%02d.png'),'-filter_complex_threads','1','-filter_complex',filters.join(';'),'-map','[v]','-map','0:a','-t',String(plan.targetSeconds),'-c:v','libx264','-threads','2','-preset','veryfast','-crf','20','-pix_fmt','yuv420p','-c:a','copy',output]);
  const records:AvatarRenderRecord[]=[{mediaId:item.id,assetHash:track.assetHash,frameCount:frames.length,frameHashes:sprite.frameHashes,fps:track.fps,loopSeconds:frames.length/track.fps,start:track.start,end:track.end,layout:track.layout,x,y,width:avatarWidth,height:avatarHeight,transparency:sprite.transparency,engine:'png-sequence/ffmpeg'}];
  return {file:output,records};
}
