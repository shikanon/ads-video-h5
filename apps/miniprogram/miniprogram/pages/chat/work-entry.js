const templates = [
  { id: 'sticker', label: '表情包动画视频', prompt: '@表情包动画视频 用我选的角色图制作一套动态表情和动画成片。' },
  { id: 'science', label: '知识科普动态图视频', prompt: '@知识科普动态图视频 ' },
  { id: 'mv', label: '音乐 MV', prompt: '@音乐MV ' },
];

const suggestions = [
  { id: 'edit', label: '把素材剪成故事', prompt: '把我选择的素材剪成 20 秒的故事短片，节奏轻快，配字幕和音乐。' },
  { id: 'explain', label: '把一个知识点讲明白', prompt: '@知识科普动态图视频 用 45 秒讲明白什么是大模型。', hint: '用 45 秒讲明白什么是大模型' },
  { id: 'news', label: '今天 AI 圈发生了什么？', prompt: '制作一段 30 秒的人工智能新闻口播视频，先搜索并核验近期事件。', hint: '帮我做一条 30 秒的 AI 新闻口播视频' },
  { id: 'sticker-hint', prompt: templates[0].prompt, hint: '用我的角色图做一套动态表情和动画视频' },
];

const starts = templates.concat(suggestions);
const labeledStarts = starts.filter(item => item.label);

function randomIndex(length) {
  return Math.floor(Math.random() * length);
}

function pickSuggestions() {
  const choices = labeledStarts.slice();
  return Array.from({ length: Math.min(3, choices.length) }, () => choices.splice(randomIndex(choices.length), 1)[0]);
}

function replaceSuggestion(visible) {
  const choices = labeledStarts.filter(item => !visible.some(current => current.id === item.id));
  if (!visible.length || !choices.length) return visible;
  const next = visible.slice();
  next[randomIndex(next.length)] = choices[randomIndex(choices.length)];
  return next;
}

function nextHint(previous) {
  const choices = suggestions.filter(item => item.hint && item.id !== previous);
  return choices[Math.floor(Math.random() * choices.length)];
}

function studioCommand(text) {
  const sticker = /^(?:[@＠](表情包动画视频|新角色动态表情|新角色静态表情|静态表情)(?=$|[\s，。:：])|(?:帮我|请)?(?:用.+)?(?:制作|生成|做)(?:一套|一组|一条)?(?:静态|动态)?表情包)/.exec(text);
  if (sticker) return { type: 'sticker', mode: /静态/.test(sticker[0]) ? 'static' : 'dynamic', text: text.slice(sticker[0].length).trim() };
  const mv = /^(?:[@＠](?:音乐\s?MV|叙事蒙太奇)(?=$|[\s，。:：])|(?:帮我|请)?(?:做|剪|制作)(?:一条|一个)?(?:音乐\s?)?MV)/i.exec(text);
  if (mv) return { type: 'mv', text: text.slice(mv[0].length).trim() };
  const note = /^(?:[@＠]笔记|写笔记|写制作笔记)(?=$|[\s:：])/.exec(text);
  if (note) return { type: 'note', text: text.slice(note[0].length).replace(/^[\s:：]+/, '') };
  const batch = /^(?:[@＠]批量制作|批量制作视频|批量制作)(?=$|[\s:：])/.exec(text);
  if (batch) return { type: 'batch', text: text.slice(batch[0].length).replace(/^[\s:：]+/, '') };
  if (/^(?:[@＠]素材|找素材|添加素材|查看素材|查看资产)$/.test(text)) return { type: 'assets' };
  if (/^(?:[@＠]项目|查找项目|查找历史项目|我的作品)$/.test(text)) return { type: 'projects' };
  if (/^(?:[@＠]批量项目|查看批量项目|查看批量进度)$/.test(text)) return { type: 'batches' };
  if (/^(?:[@＠]已有笔记|打开制作笔记|查看笔记)$/.test(text)) return { type: 'notes' };
  return null;
}

const scienceMention = /^[@＠]知识科普动态图视频(?=$|\s)/;

function suggestedRequest(text) {
  return suggestions.find(item => item.hint === text)?.prompt || text;
}

function videoMessage(text, catalog) {
  if (!scienceMention.test(text)) return text;
  const topic = text.replace(scienceMention, '').trim();
  if (!topic) throw Error('先写下你想讲明白的知识点。');
  const template = ['animated-science-video', 'video-style-diagram'].find(id => catalog.some(item => item.id === id));
  if (template) return '@' + template + ' ' + topic;
  return '制作一条知识科普动态图视频，要求：' + topic;
}

function explicitWork(text) {
  const request = suggestedRequest(text);
  return request !== text || scienceMention.test(request) || (/^[@＠]/.test(request) && Boolean(studioCommand(request))) ||
    request.split('\n').some(line => suggestions.some(item => item.label && item.prompt === line.trim()));
}

module.exports = { templates, pickSuggestions, replaceSuggestion, suggestions: suggestions.filter(item => item.label), starts, nextHint, suggestedRequest, studioCommand, videoMessage, explicitWork };
