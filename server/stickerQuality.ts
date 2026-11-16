import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PNG } from 'pngjs';
import { atomicStateWrite, stateHash } from './durableState';
import { getModelConfig, type ModelConfig } from './modelRegistry';
import type { ImageReference } from './providers';
import { jobFetch, throwIfJobCancelled } from './jobExecution';
import { withoutCreditUsage } from './creditUsage';
import { currentTaskExecution } from './taskRuntime';
import { transparentImageReference } from './transparentImageReference';
import { stickerAssets } from './stickerPacks';
import { frozenModel, frozenTextFallbacks } from './modelContext';

export const stickerQualityChecks = ['anatomy','identity','style','action','props','framing','matting'] as const;
type Check = typeof stickerQualityChecks[number];
type Status = 'passed'|'failed'|'uncertain';
export interface StickerFrameReview {
  index:number; subjects:number; heads:number;
  checks:Record<Check,{status:Status;detail:string}>;
}
export interface StickerQualityVerdict { frames:StickerFrameReview[]; passed:boolean; issues:string[]; }
export interface StickerQualityInput {
  directory:string; actionId:string; action:string; style:string;
  reference:ImageReference; styleReference?:ImageReference; anchor?:ImageReference; candidate?:ImageReference; frames:Buffer[];
}
export interface StickerQualityReceipt extends StickerQualityVerdict {
  version:1; inputHash:string; policyHash:string; modelId:string; frameHashes:string[]; candidateHash?:string; reviewedAt:string;
}
export type StickerReviewer = (input:StickerQualityInput)=>Promise<StickerQualityReceipt>;

export async function getStickerReviewConfig():Promise<ModelConfig|null>{
  const text=await getModelConfig('text');
  // Prefer an explicitly configured vision-capable Pro. During a job only
  // use the captured model/fallback snapshot, never newly edited credentials.
  const candidates=frozenModel('understanding')!==undefined?[text,...(text?frozenTextFallbacks(text):[])]:[text,await getModelConfig('text','ark-text')];
  return candidates.find((m):m is ModelConfig=>Boolean(m?.enabled&&m.modelId==='doubao-seed-2-1-pro-260915'))||await getModelConfig('understanding');
}

// Server computes the verdict. A model-level "passed":true cannot override
// a missing frame/check, an uncertain finding, or contradictory head counts.
export function validateStickerQuality(value:unknown,count:number):StickerQualityVerdict {
  const raw=value as any;
  if(!raw||!Array.isArray(raw.frames)||raw.frames.length!==count)throw Error('表情画面质检遗漏原画帧。');
  const frames:StickerFrameReview[]=[],issues:string[]=[];
  for(let index=0;index<count;index++){
    const frame=raw.frames.find((f:any)=>f?.index===index);
    if(!frame||raw.frames.filter((f:any)=>f?.index===index).length!==1||!Number.isInteger(frame.subjects)||frame.subjects<0||frame.subjects>12||!Number.isInteger(frame.heads)||frame.heads<0||frame.heads>12)throw Error('表情画面质检缺少有效的人物数量。');
    const checks={} as StickerFrameReview['checks'];
    for(const key of stickerQualityChecks){
      const c=frame.checks?.[key];
      if(!c||!['passed','failed','uncertain'].includes(c.status)||typeof c.detail!=='string'||c.detail.trim().length<3||c.detail.length>600)throw Error('表情画面质检缺少实际证据：'+key);
      checks[key]={status:c.status,detail:c.detail.trim()};
      if(c.status!=='passed')issues.push(`第${index+1}帧 ${key}：${c.detail.trim()}`);
    }
    if(frame.subjects!==1||frame.heads!==1)issues.push(`第${index+1}帧：应为一个完整角色、一颗头，实际报告${frame.subjects}个角色、${frame.heads}颗头。`);
    frames.push({index,subjects:frame.subjects,heads:frame.heads,checks});
  }
  return {frames,passed:issues.length===0,issues};
}

// Neutral display backing is only for inspection, never written to delivered
// stickers. Bound image size before sending a photo or a screenshot to vision.
export async function stickerInspectionImage(image:ImageReference):Promise<Buffer>{
  const source=PNG.sync.read(await transparentImageReference(image.bytes));
  const scale=Math.min(1,1024/Math.max(source.width,source.height)),width=Math.max(1,Math.round(source.width*scale)),height=Math.max(1,Math.round(source.height*scale)),out=new PNG({width,height});
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const p=(Math.min(source.height-1,Math.floor(y/scale))*source.width+Math.min(source.width-1,Math.floor(x/scale)))*4,q=(y*width+x)*4,alpha=source.data[p+3]/255;
    const backing=(Math.floor(x/16)+Math.floor(y/16))%2?200:130;
    for(let c=0;c<3;c++)out.data[q+c]=Math.round(source.data[p+c]*alpha+backing*(1-alpha));out.data[q+3]=255;
  }
  return PNG.sync.write(out);
}

export async function reviewStickerImage(input:StickerQualityInput,providedConfig?:ModelConfig):Promise<StickerQualityReceipt>{
  if(![1,6].includes(input.frames.length))throw Error('表情画面质检帧数无效。');
  const config=providedConfig||await getStickerReviewConfig();
  if(!config||!/^doubao-seed-2-1-/.test(config.modelId))throw Error('表情画面质检模型尚未配置，已暂停交付。');
  const policy=await readFile(path.join(stickerAssets,'..','references','quality.md'),'utf8'),policyHash=stateHash(policy),frameHashes=input.frames.map(bytes=>stateHash(bytes.toString('base64')));
  const candidateHash=input.candidate&&stateHash(input.candidate.bytes.toString('base64'));
  const inputHash=stateHash({policyHash,protocol:2,model:[config.provider,config.baseUrl,config.modelId],actionId:input.actionId,action:input.action,style:input.style,reference:stateHash(input.reference.bytes.toString('base64')),styleReference:input.styleReference&&stateHash(input.styleReference.bytes.toString('base64')),anchor:input.anchor&&stateHash(input.anchor.bytes.toString('base64')),candidate:candidateHash,frameHashes});
  const file=path.join(input.directory,`quality-${inputHash}.json`);
  try{const cached=JSON.parse(await readFile(file,'utf8'));if(cached.version===1&&cached.inputHash===inputHash&&cached.policyHash===policyHash&&cached.modelId===config.modelId&&JSON.stringify(cached.frameHashes)===JSON.stringify(frameHashes))return {...cached,candidateHash,...validateStickerQuality(cached,input.frames.length)};}catch(error){if((error as any).code!=='ENOENT')throw error;}
  const content:any[]=[];
  const image=async(label:string,ref:ImageReference)=>{content.push({type:'text',text:label},{type:'image_url',image_url:{url:'data:image/png;base64,'+(await stickerInspectionImage(ref)).toString('base64')}});};
  await image('角色身份参考；只核对所选主角，截图中的旁人、界面和舞台不是输出要求。',input.reference);
  if(input.styleReference)await image('画风参考；只参考比例、线条和材质，不复制此角色的身份。',input.styleReference);
  if(input.anchor)await image('本套已通过检查的画风锚点；核对当前画风，不照搬锚点动作。',input.anchor);
  if(input.candidate)await image('生成原图：只用于对照抠图是否误删主体、衣物、发丝或道具；纯色拍摄背景应当被去除，不要求保留。',input.candidate);
  for(const [index,bytes] of input.frames.entries())await image('待验收原画帧 index='+index,{bytes,mimeType:'image/png'});
  content.push({type:'text',text:JSON.stringify({action:input.action,style:input.style,expectedSubjects:1,expectedHeads:1,frameCount:input.frames.length,output:{frames:[{index:0,subjects:1,heads:1,checks:Object.fromEntries(stickerQualityChecks.map(key=>[key,{status:'passed|failed|uncertain',detail:'实际可见证据；有问题明确指出部位'}]))}]}})});
  const execution=currentTaskExecution();let formatError='';
  for(let attempt=0;attempt<2;attempt++){
    await execution?.consume();await execution?.assertModelBudget();
    // Inspection is a service quality cost, not an unquoted user token charge.
    const response=await withoutCreditUsage(()=>jobFetch(config.baseUrl.replace(/\/$/,'')+'/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+config.apiKey,'Content-Type':'application/json'},signal:AbortSignal.timeout(90000),body:JSON.stringify({model:config.modelId,thinking:{type:'disabled'},response_format:{type:'json_object'},max_tokens:6000,messages:[{role:'system',content:'你是独立的轻喵表情画面质检员。必须观察实际图片，按以下标准严格验收；不要输出思考过程。只返回JSON根对象 {"frames":[{"index":0,"subjects":1,"heads":1,"checks":'+JSON.stringify(Object.fromEntries(stickerQualityChecks.map(key=>[key,{status:'passed|failed|uncertain',detail:'实际可见证据'}])))+'}]}。不要输出input/output/result等包装层；frames必须列出全部待验收帧，从index=0开始。\n'+policy+(formatError?'\n上次返回格式无效：'+formatError+'。本轮仅修复JSON格式和缺失字段，不得为了通过而改变对真实画面缺陷的判断。':'')},{role:'user',content}]})}));
    if(!response.ok){await response.body?.cancel();throw Error('表情画面质检服务暂不可用（HTTP '+response.status+'），已暂停交付。');}
    const body=await response.json(),publicContent=body.choices?.[0]?.message?.content||'';
    await atomicStateWrite(path.join(input.directory,`quality-response-${inputHash}-${attempt}.json`),{inputHash,modelId:config.modelId,publicContent,finishReason:body.choices?.[0]?.finish_reason,usage:body.usage});
    let verdict:StickerQualityVerdict;
    try{verdict=validateStickerQuality(JSON.parse(publicContent),input.frames.length);}catch(error){throwIfJobCancelled();if(attempt)throw Error('表情画面质检记录不完整，已暂停交付，不会提交额外绘图请求。');formatError=(error as Error).message;continue;}
    const receipt:StickerQualityReceipt={version:1,inputHash,policyHash,modelId:config.modelId,frameHashes,candidateHash,reviewedAt:new Date().toISOString(),...verdict};
    throwIfJobCancelled();execution?.guard();await atomicStateWrite(file,{...receipt,usage:body.usage});return receipt;
  }
  throw Error('表情画面质检未完成，已暂停交付。');
}

const actions:Record<string,string>={
  '01':'一个完整主角双手抱住爱心抱枕，脸颊贴着抱枕，闭眼微笑；抱枕没有人脸、头发或四肢，不画第二个人。',
  '02':'主角用自己的双手轻轻挤压自己的脸颊，软萌微笑。','03':'主角举起自己的一只手，手掌放在自己的头顶轻揉头发，歪头微笑。',
  '04':'主角抱着柔软爱心抱枕，用脸颊轻蹭抱枕。','05':'主角微闭眼噘嘴，向前送出一颗小爱心飞吻。','06':'主角用自己的一根手指轻戳自己的脸颊。',
  '07':'主角伸出一只手，作温柔轻拍安慰的姿势，不画画外人的手。','08':'主角双手捧脸，期待地望向前方，身旁点缀一颗小爱心。','09':'主角双手抱紧爱心抱枕，露出求陪伴的神情。',
  '10':'主角微微低头，双手收在胸前，露出委屈求安慰的表情。','11':'主角双手捧空碗，微张嘴等待投喂，不画第二人的手。','12':'主角举起一只手弯起小指，向前作拉钩邀请的姿势。',
  '13':'主角微笑轻轻点头表示同意。','14':'主角抬起一根手指，露出恍然大悟的表情，旁边一个小灯泡符号。','15':'主角握拳举在胸前，神情坚定，给人鼓励。',
  '16':'主角竖起大拇指，身旁点缀小星星。','17':'主角双手合掌放在胸前，微微歪头，诚恳拜托。','18':'主角张开自己一只手掌朝前作击掌邀请，不画第二人的手。',
  '19':'主角略低头，用自己的衣袖或双手遮住下半张脸，羞涩偷看。','20':'主角用自己的双手捂住心口，开心微笑，身旁一颗粉色爱心。',
  '21':'主角鼓起脸颊，双手叉腰，轻跺自己的脚。','22':'主角双手捧住一片西瓜，睁眼好奇地看向前方。','23':'主角睁大眼睛、双手张开，露出吃惊表情。','24':'主角疲惫地坐下或趴伏成一团，身体保持合理连接。',
};
export function stickerAction(id:string){const value=actions[id];if(!value)throw Error('表情动作未定义。');return value;}
export function stickerReviewAction(id:string){return id==='20'?'一个完整主角捂住心口，开心地表达心动；一只或两只手均可，爱心装饰可选。':stickerAction(id);}
export const stickerAnatomy='只画一个完整主角、一颗头。头颈连接躯干，四肢自然连接且数量符合参考角色；不得有悬空头、重复脸、融合人体、多余尾巴、耳朵、手脚。同套保持同一脸型、头身比例、眼睛、线条、上色材质、发型、服装和角色配饰。参考照片中的手持话筒、手机、舞台和界面不是角色配饰，不带入当前动作。完整身体在画面内，四周留安全边距。';
