import type { LessonReport } from '../src/types';
import { normalizeEvidence } from './hotSources';

export const requiresTodayEvent=(prompt:string)=>prompt.split(/[。；;\n]/).some(part=>!/(?:不要|别|不是|无需).{0,12}(?:今天|今日|今早)/.test(part)&&/(?:今天|今日|今早).{0,8}(?:发生|发布|宣布|上线|公开|开源|推出)|(?:发生|发布|宣布|上线|公开|开源|推出).{0,8}(?:今天|今日|今早)|happened today|today'?s (?:release|announcement)/i.test(part));
export const beijingDate=(now=Date.now())=>new Date(now).toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'});
export const requiresSelectionReason=(prompt:string)=>prompt.split(/[。；;\n]/).some(part=>!/(?:不要|无需|不用).{0,12}(?:选题理由|选择原因|为什么选)/.test(part)&&/为什么.{0,15}(?:选|挑)|(?:说明|解释|说清|交代|说说).{0,15}(?:选.{0,12}(?:依据|原因|理由)|选题)|选题理由|explain why.{0,30}(?:chose|choose|selected)/i.test(part));

export function selectionReasonFindings(value:unknown,report:LessonReport,prompt:string):string[]{
  if(!report.hotResearch||!requiresSelectionReason(prompt))return [];
  const reason=value as {chapterId?:unknown;quote?:unknown}|undefined;
  const chapter=report.chapters?.find(c=>c.id===reason?.chapterId),quote=typeof reason?.quote==='string'?normalizeEvidence(reason.quote):'';
  const visible=chapter&&[chapter.narration,chapter.visual.takeaway,...chapter.visual.items.flatMap(i=>[i.label,i.detail])].map(normalizeEvidence);
  return quote.length>=12&&quote.length<=400&&visible?.some(text=>text.includes(quote))?[]:['用户选题依据要求：必须在旁白或实际画面中说明为什么选择这条新闻，并提供本版可定位的原句；仅说今天选某题或把理由写在内部制作记录中不足。'];
}

export function newsRenderAcceptance(prompt:string,now=Date.now()):string{
  return `当前评审日期为北京时间${beijingDate(now)}。本片按原始用户要求审查新闻，不能套用完整课堂推导、定义或编年史要求。`+
    (requiresTodayEvent(prompt)?'用户明确要求今天发生：核心事件必须有已读正文中的当日发生或首次宣布证据；报道发表于今天、今天选题、今天关注均不能满足。缺少证据仍为阻塞缺陷。':'用户要求最新热点或值得关注的报道：允许明确交代日期的近期事件，不能把旧事件冒充当日发布。')+
    (requiresSelectionReason(prompt)?'用户明确要求说明选题依据：实际旁白或画面必须说明为什么选这条新闻，仅有选题动作或内部reason记录不足；遗漏属于用户要求未满足，应放入findings。':'')+
    '判断日期误报须引用完整旁白中实际断言事件发生时间的原句，并与已读来源的事件日期核对。“今天选择/今天关注”是选题动作，不能单凭这几个字推断事件今天发生；若后文已准确说明事件和报道日期，仅建议导语写得更明确应放入suggestions。实际声称今天发布而证据不符、未满足明确的当日事件要求仍放入findings。各缺陷注明章节ID、实际音频或画面证据与修复要求；脚本事实审查通过不能代替实际成片审查。';
}

// Publication freshness alone does not prove an event happened today.
// A strict daily-event request needs a concrete dated passage in a source
// actually read, as well as the model's independent factual judgment.
export function todayEventFindings(value:unknown,report:LessonReport,prompt:string,now=Date.now()):string[]{
  if(!report.hotResearch||!requiresTodayEvent(prompt))return [];
  const date=beijingDate(now),[year,month,day]=date.split('-').map(Number);
  const months=['January','February','March','April','May','June','July','August','September','October','November','December'];
  const fullDate=new RegExp(`${year}[-/.年]0?${month}[-/.月]0?${day}(?:日|\\b)|${months[month-1]}\\s+${day}(?:st|nd|rd|th)?,?\\s+${year}\\b`, 'i');
  const shortDate=new RegExp(`(?:^|[^\\d])0?${month}月0?${day}日|${months[month-1]}\\s+${day}(?:st|nd|rd|th)?\\b`, 'i');
  const valid=Array.isArray(value)&&value.some(e=>{
    if(!e||typeof e!=='object'||e.date!==date||typeof e.quote!=='string'||e.quote.length>400)return false;
    const ref=report.references.find(r=>r.id===e.referenceId),quote=normalizeEvidence(e.quote);
    if(ref?.verification!=='news-page'||quote.length<12||!normalizeEvidence(ref.excerpt).includes(quote))return false;
    const event=/发布|宣布|上线|推出|开源|开放|更新|升级|发生|launch|announc|releas|introduc|unveil/i.test(e.quote);
    const publishedToday=Boolean(ref.publishedAt&&Number.isFinite(Date.parse(ref.publishedAt))&&beijingDate(Date.parse(ref.publishedAt))===date);
    const relative=/今天|今日|today/i.test(e.quote)&&publishedToday;
    const inferredYear=shortDate.test(e.quote)&&publishedToday&&!/(?:19|20)\d{2}/.test(e.quote);
    return event&&(fullDate.test(e.quote)||inferredYear||relative);
  });
  return valid?[]:[`用户时效要求：用户要求今天发生（北京时间${date}），本稿没有已读正文中可定位的当日核心事件证据。重新查找合格新闻，不能用今天报道旧事件或“今天看”替代。`];
}
