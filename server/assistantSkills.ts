import type { VideoTemplate } from '../shared/videoTemplates';
import { Type } from 'typebox';
import type { AgentTool } from '@earendil-works/pi-agent-core';
export interface PublicSkill { id:string;name:string;category:string;needs:string;delivers:string;entry:string;status:'available'|'needs-configuration';limit:string; }
export function isCapabilityInquiry(prompt:string){return /(?:你|轻喵|小程序).{0,12}(?:能做什么|会做什么|有什么功能|有哪些功能|有哪些技能|有哪些模板|支持哪些|能帮我做什么)|(?:介绍|列出|看看).{0,8}(?:你的|轻喵的).{0,8}(?:技能|功能|模板)/i.test(prompt);}
export function publicSkillGuide(templates:VideoTemplate[],ready:{text:boolean;image:boolean;audio:boolean;game?:boolean}):PublicSkill[]{
  const skills:PublicSkill[]=[
    {id:'research',name:'联网查证与深度探索',category:'研究',needs:'问题、领域或来源链接',delivers:'带原文依据与限制的答复',entry:'创作页选择联网搜索或深度探索',status:ready.text?'available':'needs-configuration',limit:'以本轮实际检索为准，不承诺已读取不可访问网页'},
    {id:'qingjian-hot-video',name:'热点新闻图解',category:'新闻',needs:'领域、主题、时效要求；不强制上传素材',delivers:'核验后的脚本、图解、旁白与视频',entry:'模板页新闻分类，或说“制作一个新闻资讯视频，主题……”',status:ready.text&&ready.audio?'available':'needs-configuration',limit:'时效和证据不足会明确报告；不自动发抖音'},
    {id:'qingjian-teaching-video',name:'知识教学视频',category:'知识',needs:'知识点、受众和大致时长',delivers:'有依据的讲解、图解、旁白与成片',entry:'模板页知识分类',status:ready.text&&ready.audio?'available':'needs-configuration',limit:'没有真实实验不能宣称实测'},
    {id:'qingjian-talking-head-edit',name:'口播精剪',category:'素材剪辑',needs:'用户选择的原片和剪辑要求',delivers:'保留原声的剪辑成片与制作记录',entry:'上传素材后说明保留原声、节奏和字幕要求',status:ready.text?'available':'needs-configuration',limit:'必须提供原片；不会凭空知道未分析的原话'},
    {id:'qingjian-narrative-rebuild',name:'叙事重构',category:'素材剪辑',needs:'选定素材与要讲的故事',delivers:'重新编排的镜头、叙事与视频',entry:'素材页选素材创作，再说明故事目标',status:ready.text?'available':'needs-configuration',limit:'不得把生成示意当原始实拍'},
    {id:'sticker-studio',name:'新角色静态/动态表情',category:'表情',needs:'一张角色图、画风与套装名称',delivers:'先3个样张，确认后24套静态PNG或动态GIF/WebP/APNG，可选分享视频',entry:'模板页“新角色静态表情”或“新角色动态表情”',status:ready.image?'available':'needs-configuration',limit:'需图片模型；样张必须由用户确认，制图费用未知时记为待核对，不承诺免费'},
    {id:'qingjian-author-avatar',name:'作者形象动画',category:'形象',needs:'角色参考图或符合要求的透明序列帧',delivers:'可用于视频的透明形象动画轨道',entry:'素材/作者形象入口',status:ready.image?'available':'needs-configuration',limit:'生成需图片模型，导入素材仍需技术校验'},
  ];
  for(const template of templates)skills.push({id:template.id,name:template.name,category:template.output==='game'?'游戏':template.output==='sticker-pack'?'表情':template.id==='daily-ai-frontier'?'新闻':'视频模板',needs:template.output==='sticker-pack'?'可复用已有表情，选择故事短句和音乐':'主题、受众和创作要求',delivers:template.description,entry:'模板页 → '+template.name,status:template.output==='sticker-pack'||ready.text&&(!template.defaults.narration||ready.audio)&&(template.output!=='game'||ready.game)?'available':'needs-configuration',limit:template.output==='sticker-pack'?'原轻喵素材复用不等于新角色重绘':template.output==='game'?'需后台游戏构建环境，不能声称只靠文本模型就已可玩':'按当前后台配置执行；介绍能力不会启动任务'});
  return skills;
}
export function skillGuideTool(guide:PublicSkill[]):AgentTool{
  return {name:'list_skills',label:'查看轻喵当前创作能力',description:'用户问能做什么、有哪些模板、怎么开始或哪个功能适合时，读取实际技能目录。只读，不搜索网页、不启动制作。',parameters:Type.Object({keyword:Type.Optional(Type.String({maxLength:80}))}),execute:async(_id,args)=>{const keyword=String((args as {keyword?:string}).keyword||'').trim().toLowerCase();const found=keyword?guide.filter(item=>JSON.stringify(item).toLowerCase().includes(keyword)):guide;return {content:[{type:'text',text:JSON.stringify({skills:found,notAnExecutionReceipt:true})}],details:{count:found.length}};}};
}
