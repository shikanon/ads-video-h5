import type { JobKind } from '../src/types';

export const excludesBgm = (text: string) => /(?:不要|不加|不用|不使用|无需|禁止|别加|移除|去掉|关闭|取消|remove|without|mute|no).{0,16}(?:bgm|背景音乐|配乐|background music)/i.test(text);

// Operations take precedence over nouns describing existing material. Negated
// generation requests must never synthesize a new voice or image.
export function classify(message: string): JobKind {
  const text = message.trim();
  if(/重构|重组观点|补充缺失|补充信息|联网补充|知识短片|重写叙事/.test(text) && !/只.{0,5}(?:方案|脚本)|先.{0,5}(?:方案|脚本)|不要.{0,5}(?:导出|出片|渲染)/.test(text)) return 'export';
  const exportIntent = /重新导出|导出(?:当前|现有)?方案|(?:导出|生成|制作|渲染|剪成).{0,35}(?:成片|视频|mp4)|\b(?:export|render|generate|create|make).{0,24}(?:video|film|mp4)\b|\b(?:video|film|mp4).{0,24}(?:export|render)\b/i.test(text);
  const editIntent = /剪辑|精剪|裁剪|剪成|删(?:掉|除)|去重|保留原(?:声|音)|字幕|时间轴|片段|拼接|调整|缩放|转场|画幅|时长|完整句|\b(?:edit|trim|cut|caption|subtitle|zoom|transition|reorder)\b/i.test(text);
  const analyzeIntent = /转写|转录|逐字稿|识别.{0,8}(?:音频|口播|语音)|理解.{0,8}(?:音频|口播)|分析.{0,8}(?:音频|口播|语音)|听(?:一下|懂)|\b(?:transcribe|transcript|asr)\b/i.test(text);
  if (/(审查|审阅|打分|评分|检查成片|\breview\b)/i.test(text) && !exportIntent && !editIntent) return 'review';
  if (analyzeIntent && !exportIntent && !editIntent) return 'understanding';
  const standaloneEffect = /(?:特效|动效|HTML\s*视频|effect)/i.test(text) && /(?:生成|制作|渲染|做|render|make|create)/i.test(text) && !editIntent && !/成片|素材|口播/.test(text);
  if (standaloneEffect) return 'effect';
  if (exportIntent) return 'export';
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
