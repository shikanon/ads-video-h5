import path from 'node:path';
import { stickerAssets } from './stickerPacks';
export const stickerStyles=[
  {id:'soft',name:'柔彩肖像Q版',description:'细腻柔光、自然大眼、修长一点的Q版比例',file:'styles/soft.png'},
  {id:'round',name:'圆萌大眼Q版',description:'更大的头身比、圆脸、明亮大眼与软萌表情',file:'styles/round.png'},
  {id:'lightmao',name:'轻喵同款',description:'参考轻喵24张表情的线条、配色和动作表现，保留你的角色身份',file:'pack/01/still.png'},
  {id:'custom',name:'自由描述',description:'使用自己的画风要求',file:''},
];
export const stickerStyleFile=(id:string|undefined)=>{const s=stickerStyles.find(s=>s.id===id);return s?.file?path.join(stickerAssets,s.file):undefined;};
