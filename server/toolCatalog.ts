import type {VideoTemplate} from '../shared/videoTemplates';

/** Native tool catalog excludes public example media. Private editing inputs
 * and the owner's generated deliverables are separate from discovery. */
export function toolCatalog(templates:VideoTemplate[]){
  return templates.map(({sample,...template})=>({...template,tool:{
    input:template.output==='sticker-pack'?'一张清晰的角色图、套装名称':template.output==='game'?'玩法目标、主题与交互要求':'主题或自有素材、用途与制作要求',
    steps:template.output==='sticker-pack'?['检查角色图片','制作两种画风并点选一种','生成3个样张并确认','补齐24个动作']:['补充输入与制作要求','执行制作工具','检查并导出自己的作品'],
    result:template.output==='sticker-pack'?'同一画风的静态或动态表情套装':template.output==='game'?'可编辑交互作品':'按输入制作的可编辑作品与导出文件',
  }}));
}
