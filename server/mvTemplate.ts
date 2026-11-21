import {createHash} from 'node:crypto';
import type {MediaItem} from '../shared/types';
import type {MediaFolder} from '../shared/mediaFolders';
import type {TokenPrice} from '../shared/creditTypes';
import {tokenCostMicros,POINT_MICROS} from './tokenPricing';
export interface MvTemplateInput {folderId:string;audioId:string;duration:number;resolution:480|720|1080;prompt:string;sessionId:string;position:{x:number;y:number}}
export function mvTemplateSelection(state:{media:MediaItem[];mediaFolders?:MediaFolder[]},ownerId:string,b:MvTemplateInput){
 if(!b||typeof b.folderId!=='string'||typeof b.audioId!=='string'||!Number.isInteger(b.duration)||b.duration<5||b.duration>600||![480,720,1080].includes(b.resolution)||typeof b.prompt!=='string'||!b.prompt.trim()||b.prompt.length>12000||typeof b.sessionId!=='string'||!b.position||![b.position.x,b.position.y].every(v=>Number.isFinite(v)&&Math.abs(v)<=1e9))throw Error('请选择素材文件夹、自己的音源、5–600秒时长及清晰度。');
 const folder=state.mediaFolders?.find(f=>f.ownerId===ownerId&&f.id===b.folderId),audio=state.media.find(m=>m.ownerId===ownerId&&m.id===b.audioId&&['audio','video'].includes(m.kind));
 if(!folder)throw Error('素材文件夹不存在，请重新选择。');
 if(!audio?.duration||audio.duration<b.duration-.03||audio.hasAudio===false)throw Error('所选音源没有有效声音或时长不足，请添加覆盖目标时长的音源。');
 const sources=state.media.filter(m=>m.ownerId===ownerId&&m.folderId===folder.id&&['image','video'].includes(m.kind)&&m.id!==audio.id&&m.id!==folder.mv?.referenceId&&m.libraryCollection!=='production');
 if(!sources.length||sources.length>100)throw Error('文件夹需有1–100个图片或视频原素材。参考成片和制作中间文件不作原素材。');
 return {folder,audio,sources};
}
// A transparent estimate, never a per-second debit. Settlement uses provider
// usage. Sparse-frame analysis is a fixed cost; lyrics and planning grow with
// duration. Resolution changes local rendering, not the token tariff.
export function estimateMvCredits(sources:MediaItem[],duration:number,vision:TokenPrice,text:TokenPrice){
 const cost=(p:TokenPrice,input:number,output:number,audioInput=0)=>tokenCostMicros({input,output,audioInput,cachedInput:0,cachedAudioInput:0},p);
 const analysis=sources.reduce((sum,m)=>sum+cost(vision,1000+(m.kind==='image'?1:3)*1024,1800),0);
 const lyrics=cost(vision,Math.ceil(duration*50)+Math.ceil(duration/20)*700,Math.ceil(duration/20)*1600,vision.audioInput===undefined?0:Math.ceil(duration*50));
 const planning=cost(text,2000+sources.length*1000,Math.min(16000,1200+Math.ceil(duration/3)*180));
 return Math.ceil((analysis+lyrics+planning)/POINT_MICROS*100)/100;
}
export function mvTemplatePriceHash(vision:TokenPrice,text:TokenPrice){return createHash('sha256').update(JSON.stringify([vision,text])).digest('hex');}
