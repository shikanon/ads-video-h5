import { probeAudio, runFFmpeg } from './core';
import type { LessonPacing } from '../src/types';

export function lessonVoiceStyle(pacing:LessonPacing):string{
  return `单人普通话，中性的成年男声，声音清晰、稳定自然，${pacing.mode==='brisk'?'短视频播报节奏，紧凑连贯，不作慢速课堂朗读':pacing.mode==='deliberate'?'耐心讲解，关键概念清楚':'自然讲解，句子连贯'}。语速每秒约${pacing.targetCharactersPerSecond}个中文字（每分钟约${Math.round(pacing.targetCharactersPerSecond*60)}字，不含标点）。逗号只作短停顿，句间停顿不超过${pacing.maxPauseSeconds}秒，不逐字拖长，不拉长句尾，不为凑时长增加空白。只朗读台词；不要音乐、音效、额外开场白，不朗读标点符号。术语读音：铰链读jiǎo liàn，交叉熵读jiāo chā shāng；术语说明不属于台词，不能朗读说明。`;
}

export function lessonPacingCheck(characters:number,seconds:number,pacing:LessonPacing):{passed:boolean;charactersPerSecond:number;detail:string}{
  const rate=seconds>0?characters/seconds:NaN;
  const passed=Number.isFinite(rate)&&rate>=pacing.minCharactersPerSecond&&rate<=pacing.maxCharactersPerSecond;
  return {passed,charactersPerSecond:+rate.toFixed(3),detail:`实际每秒${Number.isFinite(rate)?rate.toFixed(2):'未知'}字，规划每秒${pacing.targetCharactersPerSecond}字，允许${pacing.minCharactersPerSecond}–${pacing.maxCharactersPerSecond}字；字数不含标点，音频时长包含自然停顿。`};
}

// Preserve the actual, already-audited waveform across recovery. Tiny timing
// differences after a retake do not justify invalidating every chapter's ASR.
export function lessonTempo(rawSeconds:number,targetSeconds:number,padding:number,previous:number|undefined,rawCacheValid:boolean):number{
  if(!Number.isFinite(rawSeconds)||rawSeconds<=0||targetSeconds<=padding)throw new Error('旁白时长预算无效。');
  if(rawCacheValid&&previous!==undefined&&Number.isFinite(previous)&&previous>=.8&&previous<=1.25&&Math.abs(rawSeconds/previous+padding-targetSeconds)<=Math.max(.5,targetSeconds*.02))return previous;
  return +(rawSeconds/(targetSeconds-padding)).toFixed(5);
}

// Trim only low-energy silence touching the file edges. Keep a margin around
// the detected speech and preserve internal pauses; those require a retake.
export async function prepareLessonSpeech(file:string,output:string):Promise<{leadingTrim:number;trailingTrim:number;duration:number}>{
  const duration=await probeAudio(file);
  const log=await runFFmpeg(['-hide_banner','-nostats','-i',file,'-vn','-af','silencedetect=noise=-55dB:d=0.04','-f','null','-']);
  const gaps:Array<{start:number;end:number}>=[];let start:number|undefined;
  for(const match of log.matchAll(/silence_(start|end):\s*([\d.]+)/g)){
    if(match[1]==='start')start=Number(match[2]);
    else if(start!==undefined){gaps.push({start,end:Number(match[2])});start=undefined;}
  }
  const first=gaps[0],last=gaps.at(-1),margin=.12;
  const begin=first&&first.start<=.02?Math.max(0,first.end-margin):0;
  const end=last&&last.end>=duration-.04?Math.min(duration,last.start+margin):duration;
  if(end-begin<1)throw new Error('旁白首尾处理后不足1秒，不能继续制作。');
  await runFFmpeg(['-v','error','-y','-i',file,'-vn','-af',`atrim=start=${begin}:end=${end},asetpts=PTS-STARTPTS`,'-ar','48000','-ac','1','-c:a','pcm_s16le',output]);
  return {leadingTrim:+begin.toFixed(3),trailingTrim:+(duration-end).toFixed(3),duration:await probeAudio(output)};
}

// Inspect a level-normalized copy in the filter graph; keep the real file
// intact. Long low-energy gaps trigger re-recording, never blind speech cuts.
export async function inspectLessonSpeechGaps(file:string,maxPauseSeconds=4):Promise<Array<{start:number;end:number}>>{
  if(!Number.isFinite(maxPauseSeconds)||maxPauseSeconds<.3||maxPauseSeconds>4)throw new Error('旁白停顿上限无效。');
  const log=await runFFmpeg(['-hide_banner','-nostats','-i',file,'-vn','-af',`loudnorm=I=-16:TP=-1.5:LRA=7,silencedetect=noise=-40dB:d=${maxPauseSeconds}`,'-f','null','-']);
  const gaps:Array<{start:number;end:number}>=[];let start:number|undefined;
  for(const match of log.matchAll(/silence_(start|end):\s*([\d.]+)/g)){
    if(match[1]==='start')start=Number(match[2]);
    else if(start!==undefined){const end=Number(match[2]);if(end-start>=maxPauseSeconds-.02)gaps.push({start:+start.toFixed(3),end:+end.toFixed(3)});start=undefined;}
  }
  return gaps;
}
