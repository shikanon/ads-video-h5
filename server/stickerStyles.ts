import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { stickerAssets } from './stickerPacks';
import { fileDigest } from './artifactIntegrity';
import { stateHash } from './durableState';
export const stickerStyleVariants=[
  {id:'soft',name:'柔彩肖像Q版',description:'细腻柔光、自然大眼、修长一点的Q版比例',file:'styles/soft.png'},
  {id:'round',name:'圆萌大眼Q版',description:'更大的头身比、圆脸、明亮大眼与软萌表情',file:'styles/round.png'},
];
export const stickerStyles=[
  {id:'lightmao',name:'轻喵表情包画风',description:'参考轻喵24张表情，先制作两种候选画风，选定一种后再生成样张',file:'pack/01/still.png'},
  {id:'custom',name:'自由描述',description:'使用自己的画风要求',file:''},
];
// Keep legacy style IDs readable for existing paid projects and shared links.
export const stickerStyleFile=(id:string|undefined)=>{const s=[...stickerStyles,...stickerStyleVariants].find(s=>s.id===id);return s?.file?path.join(stickerAssets,s.file):undefined;};

/** Freeze all 24 curated references plus the chosen variation in one guide.
 * The variation determines proportions; the curated collection determines the
 * expression language. Neither contributes the user's identity. */
export async function freezeStickerStyleGuide(directory:string,id:string){
  const variant=stickerStyleVariants.find(s=>s.id===id);if(!variant)throw Error('画风候选不存在。');
  const files=[variant.file,...Array.from({length:24},(_,n)=>'pack/'+String(n+1).padStart(2,'0')+'/still.png')];
  const canvas=new PNG({width:800,height:600}),hashes:Record<string,string>={};
  for(let i=0;i<files.length;i++){
    const file=path.join(stickerAssets,files[i]),bytes=await readFile(file),png=PNG.sync.read(bytes);hashes[files[i]]=await fileDigest(file);
    const size=i===0?400:100,left=i===0?0:400+(i-1)%4*100,top=i===0?100:Math.floor((i-1)/4)*100;
    for(let y=0;y<size;y++)for(let x=0;x<size;x++){const s=(Math.min(png.height-1,Math.floor(y/size*png.height))*png.width+Math.min(png.width-1,Math.floor(x/size*png.width)))*4,d=((top+y)*800+left+x)*4;png.data.copy(canvas.data,d,s,s+4);}
  }
  const target=path.join(directory,'style-guide-'+id+'.png');await writeFile(target,PNG.sync.write(canvas),{mode:0o600});
  return {id,file:'style-guide-'+id+'.png',hash:await fileDigest(target),sourceHash:stateHash(hashes),sources:hashes};
}
