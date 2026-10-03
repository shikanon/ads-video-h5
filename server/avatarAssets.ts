import { createHash } from 'node:crypto';
import { PNG } from 'pngjs';
import type { AvatarTrack, EditPlan, MediaItem, SpriteSheet } from '../src/types';

export const AVATAR_MAX_BYTES = 20 * 1024 * 1024;
export const avatarHash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const integer = (value: unknown, min: number, max: number, label: string) => {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`形象${label}应为 ${min}–${max} 的整数。`);
  return n;
};

export function readAvatarPng(bytes: Buffer): PNG {
  if (bytes.length < 33 || bytes.length > AVATAR_MAX_BYTES || !bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error('形象序列帧需要 20 MB 以内的 PNG 图片。');
  const w = bytes.readUInt32BE(16), h = bytes.readUInt32BE(20);
  if (w < 32 || h < 32 || w > 8192 || h > 8192 || w * h > 16_777_216) throw new Error('形象图片尺寸应在 32–8192 像素内，总像素不超过 1600 万。');
  // Reject APNG rather than silently importing only its first animation frame.
  for (let p=8; p+12<=bytes.length;) {
    const len=bytes.readUInt32BE(p);
    if (p+12+len>bytes.length) throw new Error('形象 PNG 文件不完整。');
    if (bytes.toString('ascii',p+4,p+8)==='acTL') throw new Error('请上传静态序列帧网格 PNG，暂不支持 APNG。');
    p+=len+12;
  }
  try { return PNG.sync.read(bytes, { checkCRC: true }); }
  catch { throw new Error('形象 PNG 无法解码。'); }
}
export function hasAvatarAlpha(png: PNG): boolean {
  let transparent=0;
  for (let i=3;i<png.data.length;i+=4) if (png.data[i]<32) transparent++;
  return transparent > png.width*png.height*.01;
}

// Opaque generated sheets can use an explicitly requested green screen. Never
// erase black hair or white clothing by inferring the subject's background.
function removeChroma(png: PNG) {
  let removed=0;
  for (let i=0;i<png.data.length;i+=4) {
    const [r,g,b]=png.data.subarray(i,i+3);
    if (g>95 && g>r*1.6 && g>b*1.6) { png.data[i+3]=0; removed++; }
  }
  if (removed < png.width*png.height*.05) throw new Error('形象序列帧缺少透明背景，绿幕抠图也未通过，请使用透明 PNG。');
}

export function compileSpriteSheet(bytes: Buffer, input: { columns: unknown; rows: unknown; frameCount: unknown; fps: unknown; allowChroma?: boolean }) {
  const columns=integer(input.columns,1,8,'列数'), rows=integer(input.rows,1,8,'行数');
  const frameCount=integer(input.frameCount,2,32,'帧数'), fps=integer(input.fps,1,24,'帧率');
  if (frameCount>columns*rows) throw new Error('形象帧数超过序列帧格数。');
  const source=readAvatarPng(bytes); let transparency: SpriteSheet['transparency']='alpha';
  if (!hasAvatarAlpha(source)) { if (!input.allowChroma) throw new Error('形象序列帧需要透明 PNG，避免成片出现整块背景。'); removeChroma(source); transparency='chroma'; }
  const pad=8, frameWidth=Math.ceil(source.width/columns)+pad*2, frameHeight=Math.ceil(source.height/rows)+pad*2;
  if (frameWidth<48 || frameHeight<48 || frameWidth*columns>8192 || frameHeight*rows>8192 || frameWidth*frameHeight*columns*rows>16_777_216) throw new Error('形象网格尺寸不合理或补边后超过尺寸上限。');
  const sheet=new PNG({ width:frameWidth*columns,height:frameHeight*rows });
  const frames: Buffer[]=[]; const areas: number[]=[]; const centers: number[][]=[];
  for (let n=0;n<frameCount;n++) {
    const col=n%columns,row=Math.floor(n/columns);
    // Fractional grids (the user's 1774×887 image) must not lose an edge pixel.
    const x=Math.floor(col*source.width/columns),y=Math.floor(row*source.height/rows);
    const w=Math.floor((col+1)*source.width/columns)-x,h=Math.floor((row+1)*source.height/rows)-y;
    const frame=new PNG({width:frameWidth,height:frameHeight}); let area=0, sx=0,sy=0;
    for (let yy=0;yy<h;yy++) for(let xx=0;xx<w;xx++) {
      const from=((y+yy)*source.width+x+xx)*4,to=((yy+pad)*frameWidth+xx+pad)*4;
      source.data.copy(frame.data,to,from,from+4);
      if(source.data[from+3]>32){area++;sx+=xx;sy+=yy;}
    }
    if(area<w*h*.035 || area>w*h*.95) throw new Error(`形象第 ${n+1} 帧为空、格子错误或透明背景未通过。`);
    areas.push(area); centers.push([sx/area/w,sy/area/h]);
    PNG.bitblt(frame,sheet,0,0,frameWidth,frameHeight,col*frameWidth,row*frameHeight);
    frames.push(PNG.sync.write(frame));
  }
  if(Math.max(...areas)/Math.min(...areas)>1.8 || [0,1].some(axis=>Math.max(...centers.map(c=>c[axis]))-Math.min(...centers.map(c=>c[axis]))>.22)) throw new Error('形象序列帧大小或位置跳动过大，请保持相同机位和人物比例。');
  const frameHashes=frames.map(avatarHash);
  if(new Set(frameHashes).size<2) throw new Error('形象序列帧全部相同，不能作为动画。');
  const normalized=PNG.sync.write(sheet);
  const sprite:SpriteSheet={columns,rows,frameCount,fps,width:sheet.width,height:sheet.height,frameWidth,frameHeight,sha256:avatarHash(normalized),frameHashes,transparency};
  return { bytes:normalized, frames, sprite };
}

export function spriteFrames(bytes: Buffer, sprite: SpriteSheet): Buffer[] {
  if(avatarHash(bytes)!==sprite.sha256) throw new Error('形象动画文件与已确认版本不一致，请重新导入。');
  const png=readAvatarPng(bytes);
  if(png.width!==sprite.width || png.height!==sprite.height || sprite.frameWidth*sprite.columns!==png.width || sprite.frameHeight*sprite.rows!==png.height) throw new Error('形象动画尺寸与资产元数据不一致。');
  const frames:Buffer[]=[];
  for(let n=0;n<sprite.frameCount;n++) {
    const frame=new PNG({width:sprite.frameWidth,height:sprite.frameHeight});
    PNG.bitblt(png,frame,n%sprite.columns*sprite.frameWidth,Math.floor(n/sprite.columns)*sprite.frameHeight,sprite.frameWidth,sprite.frameHeight,0,0);
    const bytes=PNG.sync.write(frame);
    if(avatarHash(bytes)!==sprite.frameHashes[n])throw new Error('形象逐帧校验未通过。');
    frames.push(bytes);
  }
  return frames;
}

export function opaqueFrameDifference(expected:PNG,actual:PNG):number {
  if(expected.width!==actual.width||expected.height!==actual.height)throw new Error('形象审查帧尺寸不一致。');
  let error=0,pixels=0;
  for(let p=0;p<expected.data.length;p+=4)if(expected.data[p+3]>235){pixels++;for(let c=0;c<3;c++)error+=Math.abs(expected.data[p+c]-actual.data[p+c]);}
  if(pixels<100)throw new Error('形象不透明区域过少');
  return error/(pixels*3);
}

export function validateAvatarTracks(tracks: AvatarTrack[] | undefined, plan: EditPlan, media: MediaItem[]) {
  if(!tracks) return undefined;
  if(!Array.isArray(tracks)||tracks.length>1)throw new Error('一个视频暂支持一个作者形象轨道。');
  return tracks.map(track=>{
    const item=media.find(m=>m.id===track.mediaId && m.character?.role==='sprite'), sprite=item?.character?.sprite;
    if(!sprite || sprite.sha256!==track.assetHash || new Set(sprite.frameHashes).size<2) throw new Error('作者形象不存在、尚未生成动画或资产版本已改变。');
    if(!Number.isFinite(track.start)||!Number.isFinite(track.end)||track.start<0||track.end>plan.targetSeconds+.01||track.end-track.start<.5)throw new Error('作者形象时间范围不合法。');
    if(!Number.isInteger(track.fps)||track.fps<1||track.fps>24||!['corner','sidebar'].includes(track.layout)||!['left','right'].includes(track.position)||!Number.isFinite(track.size)||track.size<.14||track.size>.3||typeof track.reason!=='string')throw new Error('作者形象布局或帧率不合法。');
    return {...track};
  });
}
