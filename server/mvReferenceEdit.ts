import {mkdir,readFile,writeFile,rename,rm,stat,statfs} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import type {MediaItem} from '../shared/types';
import type {MvPlan,MvRecreation,MvRect,MvReferenceEdit,MvSourceTreatment} from '../shared/mvRecreation';
import {runFFmpeg,probeVideo} from './core';
import {fileDigest} from './artifactIntegrity';
import {throwIfJobCancelled} from './jobExecution';
import {createMvAss} from './mvSubtitles';

const fps=30;
const digest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const frames=(n:number,min=0,max=900)=>Number.isInteger(n)&&n>=min&&n<=max;
const rectangle=(r:any):r is MvRect=>Boolean(r&&['x','y','width','height'].every(k=>Number.isInteger(r[k]))&&r.x>=0&&r.y>=0&&r.width>=2&&r.height>=2&&r.x+r.width<=16384&&r.y+r.height<=16384);
export function validateReferenceEdit(raw:any,p:MvRecreation,media:MediaItem[]):MvReferenceEdit|undefined {
 if(raw===undefined)return;
 if(!raw||raw.version!==1||!Array.isArray(raw.canvas)||raw.canvas.length!==2||!raw.canvas.every((n:number)=>frames(n,64,3840)&&n%2===0)||!rectangle(raw.picture)||[raw.picture.width,raw.picture.height,raw.picture.x,raw.picture.y].some(n=>n%2)||raw.picture.x+raw.picture.width>raw.canvas[0]||raw.picture.y+raw.picture.height>raw.canvas[1]||!frames(raw.dissolveFrames,2,60)||raw.dissolveFrames%2||!frames(raw.fadeInFrames)||!frames(raw.fadeOutFrames)||!frames(raw.audioFadeOutFrames)||Math.max(raw.fadeInFrames,raw.fadeOutFrames,raw.audioFadeOutFrames)>p.duration*fps)throw Error('原工程画幅或转场参数无效。');
 if(raw.titleTrackId!==undefined&&!media.some(m=>m.id===raw.titleTrackId&&m.ownerId===p.ownerId&&p.sourceIds.includes(m.id)&&m.id!==p.referenceId&&m.kind==='video'&&m.duration!>=p.duration-.03))throw Error('原工程字幕透明轨不属于当前项目或时长不足。');
 if(raw.copyAudio!==undefined&&(typeof raw.copyAudio!=='boolean'||raw.copyAudio&&raw.audioFadeOutFrames))throw Error('原配乐直通时不能重复淡出。');
 return {version:1,canvas:[...raw.canvas] as [number,number],picture:{...raw.picture},dissolveFrames:raw.dissolveFrames,fadeInFrames:raw.fadeInFrames,fadeOutFrames:raw.fadeOutFrames,audioFadeOutFrames:raw.audioFadeOutFrames,...(raw.titleTrackId?{titleTrackId:raw.titleTrackId}:{}),...(raw.copyAudio!==undefined?{copyAudio:raw.copyAudio}:{})};
}
export function validateTreatment(raw:any,source:MediaItem,p:MvRecreation,media:MediaItem[]):MvSourceTreatment {
 if(!raw||!Number.isFinite(raw.speed)||raw.speed<.25||raw.speed>4||!['warm','cool'].includes(raw.grade)||!Array.isArray(raw.crops)||raw.crops.length>3||raw.crops.some((r:any)=>!rectangle(r))||raw.delogo!==undefined&&!rectangle(raw.delogo))throw Error('原工程裁切、速度或调色参数无效。');
 if(source.kind==='image'){
  if(raw.speed!==1||raw.crops.length||raw.delogo||!['in','out'].includes(raw.zoom)||!media.some(m=>m.id===raw.preparedImageId&&m.id!==p.referenceId&&m.ownerId===p.ownerId&&p.sourceIds.includes(m.id)&&m.kind==='image'))throw Error('照片镜头需要账号内的原工程裁切图及推拉方向。');
 }else if(raw.preparedImageId!==undefined||raw.zoom!==undefined)throw Error('视频镜头不能替换为照片。');
 return {speed:raw.speed,grade:raw.grade,crops:raw.crops.map((r:MvRect)=>({...r})),...(raw.delogo?{delogo:{...raw.delogo}}:{}),...(raw.preparedImageId?{preparedImageId:raw.preparedImageId,zoom:raw.zoom}:{})};
}
export function referenceUsedIds(p:MvRecreation,plan:MvPlan){return [...new Set([p.referenceId,p.audioId,...plan.shots.map(s=>s.sourceId),...plan.shots.flatMap(s=>s.treatment?.preparedImageId?[s.treatment.preparedImageId]:[]),...(plan.referenceEdit?.titleTrackId?[plan.referenceEdit.titleTrackId]:[])])];}
export function referencePictureHash(p:MvRecreation,plan:MvPlan){const {titleTrackId,...geometry}=plan.referenceEdit!;return digest({renderer:1,geometry,shots:plan.shots.map(({sourceId,start,duration,transition,treatment})=>({sourceId,start,duration,transition,treatment})),sources:Object.fromEntries(referenceUsedIds(p,plan).filter(id=>id!==titleTrackId&&id!==p.referenceId&&id!==p.audioId).map(id=>[id,p.evidence?.[id]?.sha256]))});}
const encoder=['-c:v','libx264','-preset','veryfast','-crf','17','-pix_fmt','yuv420p','-g','1','-bf','0','-threads','3','-video_track_timescale','15360'];
const filterPath=(s:string)=>s.replaceAll('\\','/').replaceAll(':','\\:').replaceAll("'","\\'");
const quote=(s:string)=>"'"+s.replaceAll('\\','/').replaceAll("'","'\\''")+"'";
async function space(dir:string,bytes:number){const s=await statfs(dir);if(s.bavail*s.bsize<512*1024*1024+bytes)throw Error('服务器制作空间不足，原工程节点已保留；请扩容或整理缓存后继续。');}
// Every published node is immutable. Re-render into a new inode, then rename;
// exports may safely hardlink completed files without later edits changing them.
async function cached(file:string,key:string,build:(temp:string)=>Promise<void>){
 try{const receipt=JSON.parse(await readFile(file+'.receipt.json','utf8'));if(receipt.key===key&&receipt.sha256===await fileDigest(file))return;}catch{}
 const temp=file+'.working.mp4';try{await build(temp);throwIfJobCancelled();const sha256=await fileDigest(temp);await rename(temp,file);await writeFile(file+'.receipt.json',JSON.stringify({key,sha256}));}finally{await rm(temp,{force:true});}
}
async function checkAlpha(file:string,dir:string,total:number,w:number,h:number){
 const geometry=await runFFmpeg(['-v','info','-i',file,'-frames:v','1','-vf','showinfo','-an','-f','null','-']);
 if(!geometry.includes('s:'+w+'x'+h+' '))throw Error('原工程字幕透明轨的尺寸与原画幅不一致。');
 // Reject opaque completed videos supplied as subtitle art. alphaextract also
 // rejects formats without an actual alpha plane. Sample across the full track.
 for(const [i,t] of [0,Math.min(8,total/2),total/2,total-.1].entries()){
  const sample=path.join(dir,'alpha-'+i+'.raw');
  try{await runFFmpeg(['-v','error','-y','-ss',String(Math.max(0,t)),'-i',file,'-frames:v','1','-vf','alphaextract,scale=192:108','-f','rawvideo','-pix_fmt','gray',sample]);const b=await readFile(sample);if(b.length!==192*108||b.reduce((n,v)=>n+(v>16?1:0),0)/b.length>.12)throw Error('字幕透明轨覆盖了过多画面，不能将成片充当字幕。');}catch(e){throw Error('字幕轨必须是真正透明的文字素材，不能使用不透明成片。',{cause:e});}finally{await rm(sample,{force:true});}
 }
}
export async function renderReferenceMv(o:{project:MvRecreation;plan:MvPlan;media:MediaItem[];file:(id:string)=>Promise<string>;directory:string;preview:boolean;dimensions?:[number,number];progress:(s:string)=>Promise<void>;onNode?:(i:number,file:string,duration:number)=>Promise<void>}){
 const p=o.project,plan=o.plan,edit=plan.referenceEdit!,[cw,ch]=edit.canvas,{width:aw,height:ah,x,y}=edit.picture;
 const dir=path.join(o.directory,'source-edit-v1-'+referencePictureHash(p,plan));await mkdir(dir,{recursive:true});
 const half=edit.dissolveFrames/2,fadeSeconds=edit.dissolveFrames/fps,total=o.preview?Math.min(20,p.duration):p.duration;
 const nodes:string[]=[],counts:number[]=[],incoming:number[]=[],outgoing:number[]=[];let elapsed=0;
 for(const [i,s] of plan.shots.entries()){
  if(elapsed>=(o.preview?total+half/fps:total)-.0001)break;
  throwIfJobCancelled();const inc=i>0&&s.transition==='fade'?half:0,out=i+1<plan.shots.length&&plan.shots[i+1].transition==='fade'?half:0;
  const n=Math.round(s.duration*fps)+inc+out,source=o.media.find(m=>m.id===s.sourceId)!,t=s.treatment!,file=path.join(dir,'clip-'+i+'.mp4');
  incoming.push(inc);outgoing.push(out);counts.push(n);await o.progress('按原工程渲染镜头 '+(i+1)+'/'+plan.shots.length);
  await cached(file,digest({n,shot:s,input:p.evidence![s.sourceId].sha256,prepared:t.preparedImageId?p.evidence![t.preparedImageId].sha256:null}),async temp=>{
   await space(dir,n/fps*cw*ch/2073600*4e6);let vf='',input:string[];
   if(source.kind==='image'){
    input=['-loop','1','-framerate','30','-i',await o.file(t.preparedImageId!)];const z=t.zoom==='in'?`1.008+0.038*on/${Math.max(1,n-1)}`:`1.046-0.038*on/${Math.max(1,n-1)}`;
    vf=`zoompan=z='${z}':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=${aw}x${ah}:fps=30`;
   }else{
    input=['-ss',String(s.start),'-i',await o.file(s.sourceId)];
    if(t.delogo){const r=t.delogo;vf+=`delogo=x=${r.x}:y=${r.y}:w=${r.width}:h=${r.height}:show=0,`;}
    for(const r of t.crops)vf+=`crop=${r.width}:${r.height}:${r.x}:${r.y},`;
    vf+=`scale=${aw}:${ah}:flags=lanczos,setpts=(PTS-STARTPTS)/${t.speed},framerate=fps=30:interp_start=0:interp_end=255:scene=15,tpad=stop_mode=clone:stop_duration=0.2`;
   }
   vf+=`,trim=end_frame=${n},setpts=N/(30*TB),eq=contrast=1.035:saturation=0.9:brightness=-0.004,colorbalance=${t.grade==='cool'?'rs=-0.012:bs=0.018':'rs=0.014:bs=-0.012'},vignette=PI/8,setsar=1,scale=in_range=auto:out_range=tv:out_color_matrix=bt709,format=yuv420p,setparams=range=limited:color_primaries=bt709:color_trc=bt709:colorspace=bt709`;
   if(i===0&&edit.fadeInFrames)vf+=`,fade=t=in:st=0:d=${edit.fadeInFrames/fps}`;
   await runFFmpeg(['-v','error','-y',...input,'-an','-vf',vf,'-frames:v',String(n),'-r','30',...encoder,temp],300000);
  });
  nodes.push(file);if(!o.preview)await o.onNode?.(i,file,n/fps);elapsed+=s.duration;
 }
 // Concat in/outpoints reference the all-intra source nodes directly, avoiding
 // another full set of body files. Centered dissolves preserve nominal cut times.
 const sequence:string[]=[];let assembledFrames=0;
 for(let i=0;i<nodes.length;i++){
  if(incoming[i]){
   const trans=path.join(dir,'transition-'+i+'.mp4'),key=digest({a:await fileDigest(nodes[i-1]),b:await fileDigest(nodes[i]),frames:edit.dissolveFrames});
   await cached(trans,key,async temp=>{await space(dir,fadeSeconds*4e6);await runFFmpeg(['-v','error','-y','-ss',String((counts[i-1]-edit.dissolveFrames)/fps),'-t',String(fadeSeconds),'-i',nodes[i-1],'-t',String(fadeSeconds),'-i',nodes[i],'-filter_complex_threads','2','-filter_complex',`[0:v]settb=1/30,setpts=N[a];[1:v]settb=1/30,setpts=N[b];[a][b]blend=all_expr='A*(1-T/${fadeSeconds})+B*T/${fadeSeconds}':shortest=1,format=yuv420p[v]`,'-map','[v]','-an','-frames:v',String(edit.dissolveFrames),'-r','30',...encoder,temp],180000);});
   sequence.push('file '+quote(trans));assembledFrames+=edit.dissolveFrames;
  }
  const body=Math.round(plan.shots[i].duration*fps)-incoming[i]-outgoing[i],start=incoming[i]?edit.dissolveFrames/fps:0;
  sequence.push('file '+quote(nodes[i]),'inpoint '+start.toFixed(9),'outpoint '+(start+body/fps).toFixed(9));assembledFrames+=body;
 }
 if(!o.preview&&assembledFrames!==Math.round(p.duration*fps))throw Error('原工程拼接帧数与时长不一致。');
 const list=path.join(dir,'sequence-'+(o.preview?'preview':'full')+'.txt');await writeFile(list,sequence.join('\n')+'\n');
 const [w,h]=o.dimensions||(o.preview?[960,540]:[cw,ch]),output=path.join(dir,'final-'+p.planHash+'-'+w+'x'+h+'-'+(o.preview?'preview':'full')+'.mp4');
 const title=edit.titleTrackId?await o.file(edit.titleTrackId):undefined;if(title)await checkAlpha(title,dir,p.duration,cw,ch);
 const subtitleFile=path.join(dir,'captions-'+p.planHash+'.ass');if(plan.captions.length)await writeFile(subtitleFile,createMvAss(plan,cw,ch,total));
 const fonts=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../assets/fonts/mashanzheng');
 await o.progress('按原工程拼接、保留原画幅并叠加字幕');
 await cached(output,digest({planHash:p.planHash,preview:o.preview,w,h,inputs:referenceUsedIds(p,plan).map(id=>p.evidence![id].sha256)}),async temp=>{
  await space(dir,total*cw*ch/2073600*2e6);
  let filters=`[0:v]pad=${cw}:${ch}:${x}:${y}:color=0x070b10[base];`;
  filters+=title?'[base][2:v]overlay=0:0:shortest=1:format=auto[title];':'[base]null[title];';
  const tail:string[]=[];if(plan.captions.length)tail.push(`ass=filename='${filterPath(subtitleFile)}':fontsdir='${filterPath(fonts)}'`);
  if(edit.fadeOutFrames)tail.push(`fade=t=out:st=${p.duration-edit.fadeOutFrames/fps}:d=${edit.fadeOutFrames/fps}`);
  if(w!==cw||h!==ch)tail.push(`scale=${w}:${h}:flags=lanczos`); // Preview only; never nested picture padding.
  filters+='[title]'+(tail.length?tail.join(','):'null')+'[out]';
  await runFFmpeg(['-v','error','-y','-f','concat','-safe','0','-i',list,'-i',await o.file(p.audioId),...(title?['-i',title]:[]),'-filter_complex_threads','2','-filter_complex',filters,'-map','[out]','-map','1:a:0','-t',String(total),'-r','30','-c:v','libx264','-preset','fast','-crf','18','-threads','4','-pix_fmt','yuv420p','-profile:v','high','-level:v','4.2','-g','60',...(edit.audioFadeOutFrames?['-af',`afade=t=out:st=${p.duration-edit.audioFadeOutFrames/fps}:d=${edit.audioFadeOutFrames/fps}`]:[]),...(edit.copyAudio?['-c:a','copy']:['-c:a','aac','-b:a','256k','-ar','48000']),'-movflags','+faststart',temp],900000);
 });
 const checked=await probeVideo(output);if(!checked.hasAudio||Math.abs(checked.duration-total)>.12)throw Error('原工程成片时长或音轨检查失败。');await runFFmpeg(['-v','error','-i',output,'-f','null','-'],600000);
 const receipt={version:1,renderer:'source-edit-v1',planHash:p.planHash,duration:checked.duration,preview:o.preview,width:w,height:h,picture:edit.picture,sha256:await fileDigest(output),technicalPassed:true,userAccepted:false,storyCaptions:plan.captions.filter(c=>c.kind!=='lyric').length,lyricCaptions:plan.captions.filter(c=>c.kind==='lyric').length,sourceHashes:Object.fromEntries(referenceUsedIds(p,plan).map(id=>[id,p.evidence![id].sha256])),limitations:plan.limitations};
 await writeFile(output+'.verification.json',JSON.stringify(receipt,null,2));return {file:output,receipt};
}
