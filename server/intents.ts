import type { ChatMessage, JobKind, LessonReport } from '../src/types';

export const excludesBgm = (text: string) => /(?:不要|不加|不用|不使用|无需|禁止|别加|移除|去掉|关闭|取消|remove|without|mute|no).{0,16}(?:bgm|背景音乐|配乐|background music)/i.test(text);

export const excludesHtml = (text: string) => /(?:不要|不用|禁止|取消|去掉).{0,8}(?:HTML|信息图|图解|生成画面)|只(?:用|保留|剪).{0,8}(?:真人|原视频|已有视频)(?!的?(?:声音|音频|音轨|原声|口播|录音))/i.test(text);
export const wantsCurrentResearch = (text:string) => /热点|热搜|热榜|新闻|资讯|快讯|时事|实时.{0,12}(?:消息|动态)|最新.{0,12}(?:消息|动态)|今天.{0,12}事件|近期.{0,12}事件|当下.{0,12}爆款|trending|\bnews\b|breaking\s+(?:news|update)/i.test(text);
export const wantsCurrentVideo = (text:string) => wantsCurrentResearch(text)&&!/(?:只|先).{0,8}(?:给|找|搜集|研究|推荐).{0,10}(?:选题|资料)|(?:给|搜集|查找|推荐|整理).{0,20}选题|不要.{0,10}(?:生成|制作).{0,8}(?:视频|成片)/.test(text)&&/(?:生成|制作|做|剪成|创作|create|make|generate).{0,70}(?:视频|短片|成片|video)/i.test(text);
export const wantsCurrentResearchOnly = (text:string) => wantsCurrentResearch(text)&&!wantsCurrentVideo(text)&&/搜集|搜索|检索|查证|选题|研究|资料|推荐/.test(text);
export const wantsLesson = (text: string) => !excludesHtml(text) && (wantsCurrentVideo(text)||/教学(?:视频|短片)|科普(?:视频|短片)|讲解.{0,50}(?:视频|短片)|(?:视频|短片).{0,50}(?:从浅入深|由浅入深)|\b(?:tutorial|educational|explainer)\s+video\b/i.test(text));
export const reusesFootage = (text: string) => /(?:用|把|将|根据|基于|保留|剪).{0,20}(?:这些|以上|这段|上传|原声|口播|真人|素材)|精剪|重构|只用原话|(?:use|edit|trim).{0,24}(?:uploaded|footage|original)/i.test(text.replace(/(?:不需要|无需|无须|不用|不要|没有).{0,8}(?:上传|提供|添加|使用)?(?:真人|视频|图片)?素材/g,''));
export function selectedHotVideoRequest(prompt:string,history:ChatMessage[]):string|undefined{
  if(excludesHtml(prompt)||reusesFootage(prompt)||!/生成|制作|做成|做|脚本|方案/.test(prompt))return;
  if(/不要.{0,12}(?:生成|制作|做成).{0,20}(?:视频|成片)/.test(prompt)&&!/脚本|方案/.test(prompt))return;
  const match=/第\s*(\d+|一|二|三)\s*(?:(?:个|条)(?!章|镜头|素材)(?:选题|视频|热点)?|选题|热点)/.exec(prompt);
  if(!match&&!/^\s*(?:请|直接|帮我)?\s*(?:生成成片|制作热点视频)\s*[。！!]?\s*$/.test(prompt))return;
  const research=history.filter(m=>m.role==='assistant'&&m.research?.brief.topics.length).at(-1)?.research;
  if(!research)return;
  const names:Record<string,number>={一:1,二:2,三:3},index=match?(names[match[1]]||Number(match[1]))-1:0;
  const topic=research.brief.topics[index];if(!topic)throw new Error(`热点选题第${index+1}项尚未通过核验，当前只有${research.brief.topics.length}个可用选题。`);
  return `制作热点解读视频，围绕已选事件“${topic.title}”重新查证，不能更换成别的热点。\n本次用户要求：${prompt}`;
}
export function lessonRequest(prompt: string, history: Array<{role:string;text:string}>, hasLesson=false, current?:LessonReport): string | undefined {
  if(excludesHtml(prompt)||reusesFootage(prompt))return undefined;
  if(wantsLesson(prompt))return prompt;
  const brief=history.filter(m=>m.role==='user'&&(wantsLesson(m.text)||reusesFootage(m.text)||excludesHtml(m.text))).at(-1)?.text;
  if((hasLesson||brief&&wantsLesson(brief)&&!reusesFootage(brief))&&/生成|导出|制作|修改|调整|改成|改为|修复|重新|时长|字幕|声音|音量|音色|语速|旁白|角注|脚注|尾注|品牌|去掉/.test(prompt)){
    const context=current?`${current.hotResearch?'制作热点解读视频':'制作教学视频'}，继续围绕当前主题${JSON.stringify(current.title)}，默认时长${current.requestedSeconds}秒，画幅${current.format}；本次要求中的新时长、画幅与语速优先。`:brief;
    const mood=current?.presentation?.mood==='urgent'&&!/紧张|迫切|紧迫|悬疑|压迫|急迫|平静|舒缓|温和|轻松|urgent|tense|suspense|calm/i.test(prompt)?` 保留紧张迫切氛围。${!current.presentation.bgm&&!/bgm|背景音乐|配乐|background music/i.test(prompt)?'不要背景音乐。':''}`:'';
    return context&&context!==prompt?`${context}${mood}\n本次要求：${prompt}`:prompt;
  }
  return undefined;
}
export const wantsReconstruction = (text: string) => !excludesHtml(text) && /重构|重组观点|补充缺失|补充信息|联网补充|知识短片|知识讲解|科普视频|教学短片|重写叙事|HTML|信息图|流程图|场景示意图|补充画面|重新绘制/i.test(text);

// A short export follows the last human production brief, not assistant text.
// Keep the brief when planning has not yet produced a reconstruction record.
export function narrativeRequest(prompt: string, history: Array<{role:string;text:string}>, hasReconstruction=false): string | undefined {
  if (excludesHtml(prompt)) return undefined;
  const brief = history.filter(m => m.role==='user' && (wantsReconstruction(m.text)||excludesHtml(m.text))).at(-1)?.text;
  if (wantsReconstruction(prompt)) return prompt;
  if (hasReconstruction || brief && wantsReconstruction(brief)) return brief && brief!==prompt ? `${brief}\n本次要求：${prompt}` : prompt;
  return undefined;
}

// Operations take precedence over nouns describing existing material. Negated
// generation requests must never synthesize a new voice or image.
export function classify(message: string): JobKind {
  const text = message.trim();
  const planOnly = /只.{0,5}(?:方案|脚本)|先.{0,5}(?:方案|脚本)|不要.{0,5}(?:导出|出片|渲染)/.test(text);
  const exportIntent = /重新导出|导出(?:当前|现有)?方案|(?:导出|生成|制作|渲染|剪成|做成).{0,35}(?:成片|视频|mp4)|\b(?:export|render|generate|create|make).{0,24}(?:video|film|mp4)\b|\b(?:video|film|mp4).{0,24}(?:export|render)\b/i.test(text);
  const editIntent = /剪辑|精剪|裁剪|剪成|删(?:掉|除)|去重|保留原(?:声|音)|字幕|时间轴|片段|拼接|调整|缩放|转场|画幅|时长|完整句|\b(?:edit|trim|cut|caption|subtitle|zoom|transition|reorder)\b/i.test(text);
  const analyzeIntent = /转写|转录|逐字稿|识别.{0,8}(?:音频|口播|语音)|理解.{0,8}(?:音频|口播)|分析.{0,8}(?:音频|口播|语音)|听(?:一下|懂)|\b(?:transcribe|transcript|asr)\b/i.test(text);
  if (/(审查|审阅|打分|评分|检查成片|\breview\b)/i.test(text) && !exportIntent && !editIntent) return 'review';
  if (analyzeIntent && !exportIntent && !editIntent) return 'understanding';
  if(wantsCurrentResearchOnly(text))return 'plan';
  const standaloneEffect = /(?:特效|动效|HTML\s*视频|effect)/i.test(text) && /(?:生成|制作|渲染|做|render|make|create)/i.test(text) && !editIntent && !/成片|素材|口播/.test(text);
  if (standaloneEffect) return 'effect';
  if (wantsLesson(text)||wantsReconstruction(text)) return planOnly ? 'plan' : 'export';
  if (exportIntent) return planOnly?'plan':'export';
  if (editIntent) return 'plan';
  if (/https:\/\/cdn\.pixabay\.com\/download\/audio\//i.test(text) || /(?:搜索|查找|找|搜|推荐).{0,35}(?:bgm|背景音乐|配乐|音乐)|(?:bgm|背景音乐|配乐|音乐).{0,24}(?:搜索|查找|推荐)/i.test(text)) return 'music';
  const wantsVoice = /(?:生成|合成|录制|写|朗读|制作).{0,12}(?:口播|配音|旁白|语音|音频)|\b(?:generate|create|write|record|synthesize|read aloud).{0,24}(?:narration|voiceover|voice-over|speech|audio)\b/i.test(text);
  const negatedVoice = /(?:不要|不用|无需|禁止|别).{0,12}(?:生成|合成|重录|制作|配音)|\b(?:do not|don't|without|no).{0,20}(?:generate|synthesize|voiceover|narration)\b/i.test(text);
  if (wantsVoice && !negatedVoice) return 'audio';
  if (/(?:生成|画|制作|画一张).{0,12}(?:封面|图片|海报|插图)|\b(?:generate|create|draw|make).{0,24}(?:image|cover|poster|illustration|picture|thumbnail)\b/i.test(text) && !/(?:不要|不用|别).{0,8}(?:生成|画|制作)/.test(text)) return 'image';
  return 'plan';
}

export function shouldUpdatePlan(message: string, hasPlan: boolean): boolean {
  // Only a pure export command reuses the current plan. Any meaningful request
  // (including a new duration, subtitle style or original audio) replans first.
  return !hasPlan || !/^(?:请|帮我|麻烦)?\s*(?:直接)?\s*(?:生成成片|导出(?:当前|现有)?(?:方案|成片|视频)?|重新导出|export(?: current)?(?: plan| video)?|render(?: video)?)\s*[。！!]?$/i.test(message.trim());
}
