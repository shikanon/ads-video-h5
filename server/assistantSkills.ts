import type { VideoTemplate } from '../shared/videoTemplates';
import { Type } from 'typebox';
import type { AgentTool } from '@earendil-works/pi-agent-core';
export interface PublicSkill { id:string;name:string;category:string;needs:string;delivers:string;entry:string;status:'available'|'needs-configuration';limit:string; }
export function isCapabilityInquiry(prompt:string){return /(?:你|轻喵|小程序).{0,12}(?:能做什么|会做什么|有什么功能|有哪些功能|有哪些技能|有哪些模板|支持哪些|能帮我做什么)|(?:介绍|列出|看看).{0,8}(?:你的|轻喵的).{0,8}(?:技能|功能|模板)/i.test(prompt);}
export function publicSkillGuide(templates:VideoTemplate[],ready:{text:boolean;image:boolean;audio:boolean;understanding?:boolean;game?:boolean}):PublicSkill[]{
  const skills:PublicSkill[]=[
    {id:'qingjian-mv-recreation',name:'原素材MV复刻',category:'音乐MV',needs:'参考片、配乐与原素材',delivers:'实际抽帧依据、可修改分镜、20秒样片、节点视频与整片',entry:'工具 → 音乐MV → 原素材复刻MV',status:ready.text&&ready.understanding?'available':'needs-configuration',limit:'最多100个原素材、10分钟；先确认分镜和样片；不生成角色，不复制参考片冒充新成片'},
    {id:'research',name:'联网查证与深度探索',category:'研究',needs:'问题、领域或来源链接',delivers:'带原文依据与限制的答复',entry:'创作页选择联网搜索或深度探索',status:ready.text?'available':'needs-configuration',limit:'以本轮实际检索为准，不承诺已读取不可访问网页'},
    {id:'qingjian-hot-video',name:'热点新闻图解',category:'新闻',needs:'领域、主题、时效要求；不强制上传素材',delivers:'核验后的脚本、图解、旁白与视频',entry:'工具页新闻分类，或说“制作一个新闻资讯视频，主题……”',status:ready.text&&ready.audio?'available':'needs-configuration',limit:'时效和证据不足会明确报告；不自动发抖音'},
    {id:'qingjian-teaching-video',name:'知识教学视频',category:'知识',needs:'知识点、受众和大致时长',delivers:'有依据的讲解、图解、旁白与成片',entry:'工具页知识分类',status:ready.text&&ready.audio?'available':'needs-configuration',limit:'没有真实实验不能宣称实测'},
    {id:'qingjian-talking-head-edit',name:'口播精剪',category:'素材剪辑',needs:'用户选择的原片和剪辑要求',delivers:'保留原声的剪辑成片与制作记录',entry:'上传素材后说明保留原声、节奏和字幕要求',status:ready.text?'available':'needs-configuration',limit:'必须提供原片；不会凭空知道未分析的原话'},
    {id:'qingjian-narrative-rebuild',name:'叙事重构',category:'素材剪辑',needs:'选定素材与要讲的故事',delivers:'重新编排的镜头、叙事与视频',entry:'素材页选素材创作，再说明故事目标',status:ready.text?'available':'needs-configuration',limit:'不得把生成示意当原始实拍'},
    {id:'sticker-studio',name:'轻喵表情包画风',category:'表情',needs:'一张清晰且能确定单个主角的新角色图、套装名称',delivers:'先检查参考图，参考轻喵24张表情制作两种候选画风；用户点选一种后生成3个样张，确认后制作同一画风的24个静态或动态表情',entry:'工具页 → 轻喵表情包画风',status:ready.image?'available':'needs-configuration',limit:'逐阶段使用用户积分；未选择画风不生成动作，未确认样张不扩整套；无法辨认主角时说明可见问题并建议替换图片，不能仅看文件名断言可生成，不承诺供应商一定接受'},
    {id:'qingjian-author-avatar',name:'作者形象动画',category:'形象',needs:'角色参考图或符合要求的透明序列帧',delivers:'可用于视频的透明形象动画轨道',entry:'素材/作者形象入口',status:ready.image?'available':'needs-configuration',limit:'生成需图片模型，导入素材仍需技术校验'},
  ];
  for(const template of templates.filter(item=>item.output!=='sticker-pack'))skills.push({id:template.id,name:template.name,category:template.output==='game'?'游戏':template.output==='sticker-pack'?'表情':template.id==='daily-ai-frontier'?'新闻':'创作工具',needs:template.output==='sticker-pack'?'可复用已有表情，选择故事短句和音乐':'主题、受众和创作要求',delivers:template.description,entry:'工具页 → '+(template.output==='sticker-pack'?'轻喵表情包画风':template.name),status:template.output==='sticker-pack'||ready.text&&(!template.defaults.narration||ready.audio)&&(template.output!=='game'||ready.game)?'available':'needs-configuration',limit:template.output==='sticker-pack'?'原轻喵素材复用不等于新角色重绘':template.output==='game'?'需后台游戏构建环境，不能声称只靠文本模型就已可玩':'按当前后台配置执行；介绍能力不会启动任务'});
  return skills;
}
export function skillGuideTool(guide:PublicSkill[]):AgentTool{
  return {name:'list_skills',label:'查看轻喵当前创作能力',description:'用户问能做什么、有哪些模板、怎么开始或哪个功能适合时，读取实际技能目录。只读，不搜索网页、不启动制作。',parameters:Type.Object({keyword:Type.Optional(Type.String({maxLength:80}))}),execute:async(_id,args)=>{const keyword=String((args as {keyword?:string}).keyword||'').trim().toLowerCase();const found=keyword?guide.filter(item=>JSON.stringify(item).toLowerCase().includes(keyword)):guide;return {content:[{type:'text',text:JSON.stringify({skills:found,notAnExecutionReceipt:true})}],details:{count:found.length}};}};
}
