import { PNG } from 'pngjs';
import { hasAvatarAlpha, readAvatarPng } from './avatarAssets';
import { transparentImageReference } from './transparentImageReference';
import type { ImageReference } from './providers';

export type StickerChroma = { name:string; hex:string; channels:number[] };
const keys:StickerChroma[]=[{name:'绿色',hex:'#00FF00',channels:[1]},{name:'洋红色',hex:'#FF00FF',channels:[0,2]},{name:'青色',hex:'#00FFFF',channels:[1,2]}];
function chroma(png:PNG,p:number,key:StickerChroma){
  let high=255,low=0;for(let c=0;c<3;c++){if(key.channels.includes(c))high=Math.min(high,png.data[p+c]);else low=Math.max(low,png.data[p+c]);}
  return {high,low,excess:high-low};
}
export async function stickerBackground(reference:ImageReference):Promise<{background:'transparent'|'opaque';key?:StickerChroma;reference:ImageReference}>{
  const bytes=await transparentImageReference(reference.bytes),png=readAvatarPng(bytes);
  if(hasAvatarAlpha(png))return {background:'transparent',reference:{bytes,mimeType:'image/png'}};
  // An ordinary photo must not be passed to Seedream 5.0's transparent mode.
  // Select a deliberate studio backdrop with little overlap in the reference.
  const ranked=keys.map((key,index)=>{let count=0;for(let p=0;p<png.data.length;p+=64){const c=chroma(png,p,key);if(c.high>100&&c.excess>45)count++;}return {key,count,index};}).sort((a,b)=>a.count-b.count||a.index-b.index);
  if(ranked[0].count/Math.ceil(png.data.length/64)>.005)throw Error('角色图片包含全部可用抠图背景色，无法安全去背景。请使用已抠除背景的角色PNG。');
  return {background:'opaque',key:ranked[0].key,reference};
}
export function stickerBackgroundInstructions(key?:StickerChroma){
  return key?`本次使用纯色抠图拍摄模式：全部背景和主体之间的空隙必须填完全均匀的纯${key.name}${key.hex}，不画场景、阴影、渐变、棋盘格、文字或边框。人物保持原有颜色，不在主体上使用背景色。输出PNG，后续程序会去除指定背景色。`:'使用真实透明的 RGBA 背景，禁止绘制棋盘格、白底、绿幕或场景背景。';
}
export function removeStickerBackdrop(bytes:Buffer,key:StickerChroma):Buffer{
  const png=readAvatarPng(bytes),{width:w,height:h}=png,total=w*h,mask=new Uint8Array(total),queue=new Uint32Array(total);let head=0,tail=0;
  const add=(n:number)=>{if(mask[n])return;const p=n*4,c=chroma(png,p,key);if(png.data[p+3]<16||(c.high>=90&&c.low<170&&c.excess>=35)){mask[n]=1;queue[tail++]=n;}};
  for(let x=0;x<w;x++){add(x);add((h-1)*w+x);}for(let y=1;y<h-1;y++){add(y*w);add(y*w+w-1);}
  // First prove the outside canvas actually has the requested backdrop. The
  // chosen color was checked against the reference and reserved for background.
  while(head<tail){const n=queue[head++],x=n%w,y=Math.floor(n/w);if(x)add(n-1);if(x+1<w)add(n+1);if(y)add(n-w);if(y+1<h)add(n+w);}
  if(tail<total*.03||tail>total*.965)throw Error('指定纯色背景未通过抠图检查，已保留模型原图，请调整生成要求后重试。');
  // Arms and legs can enclose background regions disconnected from the border.
  for(let n=0;n<total;n++)if(!mask[n]){const c=chroma(png,n*4,key);if(c.high>=90&&c.low<170&&c.excess>=35){mask[n]=1;tail++;}}
  if(tail>total*.965)throw Error('抠图后主体过小，未通过表情检查。');
  for(let n=0;n<total;n++){
    const p=n*4;if(mask[n]){png.data.fill(0,p,p+4);continue;}
    const c=chroma(png,p,key);if(c.high<60||c.excess<8)continue;
    const x=n%w,y=Math.floor(n/w);let edge=false;
    for(let yy=Math.max(0,y-4);yy<=Math.min(h-1,y+4)&&!edge;yy++)for(let xx=Math.max(0,x-4);xx<=Math.min(w-1,x+4);xx++)if(mask[yy*w+xx]){edge=true;break;}
    if(!edge)continue;
    const alpha=Math.max(1,255-c.excess),old=png.data[p+3];
    for(let channel=0;channel<3;channel++)png.data[p+channel]=Math.max(0,Math.min(255,Math.round((png.data[p+channel]-(key.channels.includes(channel)?255-alpha:0))*255/alpha)));
    png.data[p+3]=Math.min(old,alpha);
  }
  if(!hasAvatarAlpha(png))throw Error('背景处理未得到真实透明像素。');
  return PNG.sync.write(png);
}

// Interpolate premultiplied colors so transparent backdrop RGB cannot bleed
// into hair/white clothing when a 2K model result becomes a 512px sticker.
export const stickerFrameFilter='format=gbrap,premultiply=planes=7:inplace=1,scale=512:512:force_original_aspect_ratio=decrease,unpremultiply=planes=7:inplace=1,format=rgba,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=black@0';

export function stickerMotionReference(bytes:Buffer):Buffer {
  const identity=readAvatarPng(bytes);if(identity.width!==512||identity.height!==512||!hasAvatarAlpha(identity))throw Error('角色底稿未通过动画参考检查。');
  const sheet=new PNG({width:2496,height:1664});
  for(let n=0;n<6;n++)PNG.bitblt(identity,sheet,0,0,512,512,n%3*832+160,Math.floor(n/3)*832+160);
  return PNG.sync.write(sheet);
}

export function validateStickerMotion(frames:Buffer[]):void {
  const images=frames.map(readAvatarPng),first=images[0];let area=0,maxDifference=0;
  for(let p=3;p<first.data.length;p+=4)if(first.data[p]>32)area++;
  for(const image of images.slice(1)){
    if(image.width!==first.width||image.height!==first.height)throw Error('表情动作帧尺寸不一致。');
    let difference=0;for(let p=3;p<first.data.length;p+=4){
      if((first.data[p]>32)!==(image.data[p]>32))difference++;
      else if(first.data[p]>223&&image.data[p]>223&&Math.abs(first.data[p-3]-image.data[p-3])+Math.abs(first.data[p-2]-image.data[p-2])+Math.abs(first.data[p-1]-image.data[p-1])>60)difference++;
    }
    maxDifference=Math.max(maxDifference,difference);
  }
  if(!area||maxDifference/area<.02)throw Error('动作变化过小，不能将重复人像作为动态表情，请重新制作样张。');
}
