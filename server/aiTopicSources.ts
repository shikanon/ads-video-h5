/** Search starting points, never evidence or a pre-written current-news answer. */
const domains=[
  {id:'models',match:/模型|编程|办公|助手|agent|codex|chatgpt|claude|deepseek|AI|人工智能/i,sites:['openai.com/news','anthropic.com/news','huggingface.co/blog']},
  {id:'robotics',match:/机器人|仿真|robot|simulat/i,sites:['research.nvidia.com','huggingface.co/blog','deepmind.google/blog']},
  {id:'science',match:/科学|生命|气象|天气|化学|蛋白|science|weather|protein|alphafold/i,sites:['deepmind.google/blog','ebi.ac.uk','research.google/blog']},
  {id:'creative',match:/创作|绘图|视频|音乐|水印|creative|image|video|music/i,sites:['huggingface.co/blog','deepmind.google/blog','research.google/blog']},
];
export function aiTopicSourcePlan(subject:string){
  const relevant=domains.filter(domain=>domain.match.test(subject));
  if(!relevant.length)return '';
  const broad=/各领域|不限|不同领域|前沿|AI圈|人工智能热点/i.test(subject),selected=broad?domains:relevant;
  const sites=[...new Set(selected.flatMap(domain=>domain.sites))];
  return `AI选题检索起点（不是已核验来源）：${sites.map(site=>'site:'+site).join('、')}。${broad?'跨模型/工具、机器人、生命科学/气象/化学、创作等领域选不同问题，不固定为办公技巧。':'围绕用户指定领域，不为了凑热点换掉对象或版本。'}先用具体机制/产品关键词加日期搜索，优先近48小时的一手公告/论文/官方文档，再寻找独立发布者的可读正文。原文章发布时间、事件日、检索时间分别记录；缺少小时保留日期粒度。Hugging Face社区文章须核作者与所属机构，不能把平台域名当厂商官方。博客目录只用于发现，最终事实必须回到具体正文。没有符合时效的材料时报告缺口；只在用户允许常青内容时讲明确标注为常青的方法，不把旧稿当今天上线。热榜排名只说明该榜该时刻信号，不证明能力或事实。对比/实测必须真实执行并保留输入、输出和边界，原创示意须标注，不能冒充实测。`;
}
