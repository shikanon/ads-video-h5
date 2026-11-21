import {mkdir,readFile} from 'node:fs/promises';
import path from 'node:path';
import type {MvCaption,MvRecreation} from '../shared/mvRecreation';
import type {TranscriptSentence} from '../shared/types';
import type {ModelConfig} from './modelRegistry';
import {transcribeWindow,validateTranscript} from './audioUnderstanding';
import {fileDigest} from './artifactIntegrity';
import {atomicStateWrite} from './durableState';
import {throwIfJobCancelled} from './jobExecution';
import {probeAudio} from './core';

export function lyricCaptions(sentences:Pick<TranscriptSentence,'words'>[]):MvCaption[]{
 const result:MvCaption[]=[];
 for(const s of sentences){let words:TranscriptSentence['words']=[];
  const flush=()=>{if(words.length){result.push({kind:'lyric',start:words[0].start,end:words.at(-1)!.end,text:words.map(w=>w.text).join(''),words});words=[];}};
  for(const word of s.words){if(words.length&&(word.start-words.at(-1)!.end>.8||[...words.map(w=>w.text).join('')+word.text].length>18))flush();words.push({...word});}flush();
 }
 return result;
}
export async function recognizeMvLyrics(o:{project:MvRecreation;file:string;directory:string;config:ModelConfig;save:()=>Promise<void>;progress:(s:string)=>Promise<void>}){
 const p=o.project,hash=await fileDigest(o.file),duration=await probeAudio(o.file);
 if(!p.evidence?.[p.audioId]||p.evidence[p.audioId].sha256!==hash||duration<p.duration-.1)throw Error('配乐已变化或时长不足，请重新分析素材。');
 const dir=path.join(o.directory,'lyrics-'+hash+'-'+o.config.modelId.replace(/[^\w-]/g,'_'));await mkdir(dir,{recursive:true});
 const sentences:Omit<TranscriptSentence,'id'>[]=[];
 for(let start=0,index=0;start<p.duration-.01;start+=20,index++){
  throwIfJobCancelled();const length=Math.min(20,p.duration-start),cache=path.join(dir,'chunk-'+index+'.json');let items:Omit<TranscriptSentence,'id'>[]|undefined;
  try{const old=JSON.parse(await readFile(cache,'utf8'));if(old.version===1&&old.audioHash===hash&&old.modelId===o.config.modelId&&old.start===start&&old.duration===length)items=validateTranscript({sentences:old.sentences},length);}catch(error){if((error as NodeJS.ErrnoException).code&& (error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  await o.progress('识别歌词 '+(index+1)+'/'+Math.ceil(p.duration/20)+' · 需试听校对');
  if(!items){items=await transcribeWindow(o.file,start,length,o.config,dir,0,'音乐MV原配乐的实际演唱，间奏不填词');await atomicStateWrite(cache,{version:1,audioHash:hash,modelId:o.config.modelId,start,duration:length,sentences:items});}
  sentences.push(...items.map(s=>({...s,start:+(s.start+start).toFixed(3),end:+(s.end+start).toFixed(3),words:s.words.map(w=>({...w,start:+(w.start+start).toFixed(3),end:+(w.end+start).toFixed(3)}))})));
 }
 throwIfJobCancelled();if(await fileDigest(o.file)!==hash)throw Error('识别期间配乐发生变化。');
 p.lyricDraft={audioHash:hash,captions:lyricCaptions(sentences),timing:'model-estimated',warnings:['歌词仅从所选配乐实际识别，没有按歌曲名补写或填满间奏。','演唱、伴奏可能造成错字漏字；字词时间为模型估计，未完成独立强制对齐，请试听校对后采用。']};p.updatedAt=new Date().toISOString();await o.save();return p.lyricDraft;
}
