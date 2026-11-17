const mentionPattern = /(?:^|\s)[@＠]([^\s@＠，。！？,;；:：]{1,64})(?=$|[\s，。！？,;；:：])/g;

function draftMentions(text, templates) {
  return Array.from(text.matchAll(mentionPattern)).flatMap(match => {
    const template = templates.find(item => item.id === match[1] || item.name === match[1]);
    if (!template) return [];
    const end = match.index + match[0].length;
    return [{ template, start: end - match[1].length - 1, end: text[end] === ' ' ? end + 1 : end }];
  });
}

function selectedTemplateName(text, templates) {
  const first = draftMentions(text, templates)[0];
  return first ? first.template.name : '';
}

function withoutTemplateMentions(text, templates) {
  for (const { start, end } of draftMentions(text, templates).reverse()) {
    text = text.slice(0, start) + text.slice(end);
  }
  return text.trimStart();
}

const skillStarters = [
  { id: 'sticker-studio-dynamic', name: '新角色动态表情', category: 'stickers', icon: 'create', description: '上传你的角色，先生成两种候选画风，点选后制作3个样张，确认后生成24个动态表情。', studioMode: 'dynamic', coverTitle: '让你的角色\n动起来', coverNote: '角色 · 动作 · 分享' },
  { id: 'sticker-studio-static', name: '新角色静态表情', category: 'static-stickers', icon: 'library', description: '上传你的角色，先生成两种候选画风，点选后制作3个样张，确认后生成24张透明PNG。', studioMode: 'static', coverTitle: '一种心情\n一张表情', coverNote: '角色 · 画风 · 心情' },
  { id: 'qingjian-hot-video', name: '热点新闻', category: 'news', icon: 'films', description: '查证热点、整理来源，制作新闻图解短片。', prompt: '制作一个新闻资讯视频，主题：', coverTitle: '把新鲜事\n讲清楚', coverNote: '查证 · 图解 · 播报' },
  { id: 'qingjian-teaching-video', name: '知识教学', category: 'knowledge', icon: 'idea', description: '从一个知识点出发，研究、讲解、配音并制作教学视频。', prompt: '制作一个知识教学视频，讲解：', coverTitle: '一个知识点\n讲到你懂', coverNote: '研究 · 讲解 · 成片' },
  { id: 'qingjian-talking-head-edit', name: '口播精剪', category: 'editing', icon: 'films', description: '用上传的口播素材整理节奏，保留原声，剪出流畅成片。', prompt: '请精剪我上传的口播素材，保留原声。要求：', coverTitle: '好好说的话\n值得被听见', coverNote: '原声 · 节奏 · 精剪' },
  { id: 'qingjian-narrative-rebuild', name: '叙事重构', category: 'editing', icon: 'create', description: '重新组织叙事与镜头，把零散素材剪成故事。', prompt: '请用我上传的素材重新组织叙事并制作视频。故事主题：', coverTitle: '零散片段\n连成一个故事', coverNote: '素材 · 镜头 · 叙事' },
];
const categoryLabels = { all: '全部', game: '游戏', stickers: '动态表情', 'static-stickers': '静态表情', knowledge: '知识', news: '新闻', product: '产品动效', editing: '素材剪辑' };
function skillStarter(id) { return skillStarters.find(item => item.id === id); }
function isSkillPrompt(prompt) { return skillStarters.some(item => item.prompt && prompt.startsWith(item.prompt)); }
function templateCategory(template) {
  if(template.id==='daily-ai-frontier')return 'news';
  if (template.output === 'game' || template.id === 'defold-game' || template.id === 'video-style-pixel') return 'game';
  if (template.output === 'sticker-pack') return 'stickers';
  if (template.id === 'animated-science-video' || template.id === 'video-style-diagram') return 'knowledge';
  return 'product';
}
function galleryCategories(cards) {
  return Object.keys(categoryLabels).filter(id => id === 'all' || cards.some(card => card.category === id)).map(id => ({ id, name: categoryLabels[id] }));
}
function galleryCards(templates, client) {
  const cards=templates.map(template => {
    const sticker=template.output==='sticker-pack',category=templateCategory(template);
    return {
      id:template.id,name:sticker?'轻喵表情包画风':template.name,description:sticker?'参考轻喵24张表情，先比较你的角色的两种画风，点选一种后制作整套。':template.description,
      output:template.output,category,categoryName:categoryLabels[category],coverTitle:sticker?'轻喵表情包画风':template.name,coverNote:'提供输入 · 制作 · 导出',
      format:sticker?'角色表情工具':template.output==='game'?'交互制作工具':'创作工具',
      icon:template.output==='game'?'create':sticker?'library':template.id.includes('science')||template.id.includes('diagram')?'idea':'films',
      skill:true,seconds:0,sample:null,studioMode:sticker?'dynamic':undefined,
      input:template.tool&&template.tool.input||'主题或自己的素材、用途与要求',
      steps:template.tool&&template.tool.steps||['补充输入与要求','执行制作','检查并导出作品'],
      result:template.tool&&template.tool.result||'根据你的输入制作作品',
    };
  });
  return cards.concat(skillStarters.map(item=>Object.assign({},item,{categoryName:categoryLabels[item.category],skill:true,starter:true,sample:null,seconds:0,format:'创作工具',input:item.studioMode?'一张清晰的角色图、套装名称':'主题或自己的素材、用途与要求',steps:item.studioMode?['生成两种候选画风','点选一种后制作3个样张','确认后补齐24个动作']:['补充输入与要求','执行制作','检查并导出作品'],result:item.studioMode?'保持同一画风的角色表情':'按输入制作的作品'})));
}

module.exports = { selectedTemplateName, withoutTemplateMentions, galleryCards, galleryCategories, skillStarter, isSkillPrompt };
