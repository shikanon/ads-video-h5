import { Type } from 'typebox';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { HotResearchBrief, ResearchReference, WorkflowEvent } from '../src/types';
import type { ModelConfig } from './modelRegistry';
import type { ResearchResult } from './researchTypes';
import { getAgent } from './core';
import { createToolTrace, observeToolErrors } from './toolTrace';
import { discoverHotTopics, newsWindowHours, normalizeEvidence, verifyNewsPages } from './hotSources';
import { mergeResearch, researchGaps } from './narrativeResearch';
import { loadEditingSkill } from './skills';
import type { PublicReader } from './publicResearch';

export function currentResearchExpired(result:ResearchResult,now=Date.now()):boolean{
  const c=result.current;if(!c)return true;
  const asOf=Date.parse(c.asOf),expires=Date.parse(c.expiresAt);
  return !Number.isFinite(asOf)||!Number.isFinite(expires)||asOf>now+60000||now>=expires||expires-asOf>30*60000;
}
export function newsPublisher(url:string):string{
  const host=new URL(url).hostname.toLowerCase().replace(/^www\./,'');
  const parts=host.split('.');return parts.slice(/\.(?:com|co|org)\.[a-z]{2}$/.test(host)?-3:-2).join('.');
}
export function newsPassages(ref:ResearchReference):Array<{id:string;text:string}>{
  const parts=ref.excerpt.match(/[^。！？.!?]{12,280}(?:[。！？.!?]|$)|[^。！？.!?]{12,280}/g)||[];
  return parts.map(text=>text.trim()).filter(text=>normalizeEvidence(text).length>=12).slice(0,42).map((text,i)=>({id:`${ref.id}-p${i+1}`,text}));
}
export function hydrateHotEvidence(topics:any[],refs:ResearchReference[]):HotResearchBrief['topics']{
  const passages=new Map(refs.flatMap(ref=>newsPassages(ref).map(p=>[p.id,{referenceId:ref.id,quote:p.text}] as const)));
  return topics.map(topic=>({...topic,facts:topic.facts.map((fact:any)=>({...fact,evidence:fact.evidence.map((e:any)=>{
    const p=passages.get(e.passageId);if(!p||e.referenceId!==undefined&&p.referenceId!==e.referenceId)throw new Error(`新闻证据片段ID ${String(e.passageId)} 不在对应实际来源内。只能选择已读正文的 passageId；baidu/hn 榜单编号仅放在 signalIds，不能作为新闻事实证据。`);return {...p};
  })}))}));
}
export function hotBriefParameters(refs:ResearchReference[]){
  const passage=Type.Union(refs.flatMap(newsPassages).map(p=>Type.Literal(p.id)),{description:'仅选择实际已读正文片段ID，来源编号与原话由程序补全。'});
  return Type.Object({topics:Type.Array(Type.Object({title:Type.String({maxLength:180}),hook:Type.String({maxLength:300}),angle:Type.String({maxLength:500}),signalIds:Type.Array(Type.String()),facts:Type.Array(Type.Object({text:Type.String({maxLength:400}),evidence:Type.Array(Type.Object({passageId:passage},{additionalProperties:false}),{minItems:1,maxItems:3})}),{minItems:1,maxItems:4,description:'每题只保留1–4条核心新闻事实；榜单排名、热度、访问日期不属于这里的新闻事实。'}),visualPlan:Type.String({maxLength:500}),uncertainties:Type.Array(Type.String({maxLength:500}))}),{maxItems:3})});
}
export function validateHotBrief(topics:HotResearchBrief['topics'],refs:ResearchReference[],signals:HotResearchBrief['signals']):HotResearchBrief['topics']{
  if(!Array.isArray(topics)||topics.length>3)throw new Error('热点选题最多3个。');
  const reference=new Map(refs.map(r=>[r.id,r])),signalIds=new Set(signals.map(s=>s.id));
  for(const topic of topics){
    if(![topic.title,topic.hook,topic.angle,topic.visualPlan].every(v=>typeof v==='string'&&v.trim()&&v.length<=500)||!Array.isArray(topic.uncertainties)||topic.uncertainties.some(s=>typeof s!=='string'||s.length>500))throw new Error('热点标题、钩子、角度和画面计划格式无效。');
    if(!Array.isArray(topic.signalIds)||topic.signalIds.some(id=>!signalIds.has(id)))throw new Error('热点关联的榜单ID不存在，不得编造热度。');
    if(!Array.isArray(topic.facts)||!topic.facts.length||topic.facts.length>4)throw new Error('每个选题需要1–4条有原文证据的事实。');
    const sources:ResearchReference[]=[];
    for(const fact of topic.facts){
      if(typeof fact.text!=='string'||!fact.text.trim()||fact.text.length>400||!Array.isArray(fact.evidence)||!fact.evidence.length||fact.evidence.length>3)throw new Error('每条新闻事实须有可定位的原文证据。');
      for(const evidence of fact.evidence){
        const ref=reference.get(evidence.referenceId);
        if(!ref||ref.verification!=='news-page'||ref.freshness==='future')throw new Error('新闻事实引用须来自实际读取的非未来网页。');
        const quote=normalizeEvidence(evidence.quote||'');
        if(quote.length<12||quote.length>300||!normalizeEvidence(ref.excerpt).includes(quote))throw new Error('新闻证据摘录不在实际读取的正文内。');
        sources.push(ref);
      }
    }
    if(new Set(sources.map(r=>newsPublisher(r.url))).size<2)throw new Error('热点选题至少需要两家独立发布者的实际正文，不把同站子域名当多来源。');
    if(!sources.some(r=>r.freshness==='fresh'))throw new Error('热点选题缺少时效窗口内的真实发布时间，旧稿或无日期资料只能作背景。');
  }
  return structuredClone(topics);
}

export async function researchHotTopics(config:ModelConfig,prompt:string,progress?:(events:WorkflowEvent[])=>Promise<void>,options:{read?:PublicReader;trace?:ReturnType<typeof createToolTrace>;search?:typeof researchGaps}={}):Promise<ResearchResult>{
  const asOf=new Date().toISOString(),windowHours=newsWindowHours(prompt),expiresAt=new Date(Date.parse(asOf)+30*60000).toISOString();
  const trace=options.trace||createToolTrace(progress||(async()=>{}),[config.apiKey]);
  const skill=await loadEditingSkill('qingjian-hot-video');
  const discovered=await trace.run('discover_hot_topics','读取实时热榜',{sources:['baidu','hackernews']},()=>discoverHotTopics(options.read));
  let selection:{signalIds:string[];queries:string[]}|undefined;
  const choose:AgentTool={name:'select_hot_topics',label:'选择热点与查证问题',description:'根据用户领域从真实榜单选择0–2个相关ID，提交1–2条具体新闻查证查询。没有相关榜单时按用户领域查新闻；不得编造榜单ID。',parameters:Type.Object({signalIds:Type.Array(Type.String(),{maxItems:2}),queries:Type.Array(Type.String({minLength:2,maxLength:240}),{minItems:1,maxItems:2})}),execute:async(_id,args)=>{
    const a=args as NonNullable<typeof selection>;
    if(a.signalIds.some(id=>!discovered.signals.some(s=>s.id===id)))throw new Error('选择的热点ID不在真实榜单内。');
    selection=structuredClone(a);return {content:[{type:'text',text:'已确定检索问题，随后实际联网读取来源。'}],details:a};
  }};
  async function plan(tool:AgentTool,input:string,done:()=>boolean){
    const agent=getAgent(config,trace.wrap([tool]),skill,true),drain=observeToolErrors(agent,trace);let turns=0;
    agent.finishTurn=()=>({action:done()||++turns>=3?'end':'continue'});
    const timer=setTimeout(()=>agent.abort(),180000);
    try{await agent.prompt(`必须调用 ${tool.name} 提交结果，严格遵守参数中的条数与可选ID；工具校验失败时修正具体错误再提交。\n`+input);}finally{clearTimeout(timer);await drain();}
    if(!done())throw new Error('热点研究 Agent 未提交经过校验的结果，请重试。');
  }
  const userDemand=`用户需求：${prompt.slice(0,3000)}\n资料截止UTC ${asOf}；新闻时效窗口${windowHours}小时。用户指定的名称、版本和事件必须锁定，不能换成别的榜单热点。未核实的发布或能力传闻应查证传闻本身和官方状态，保留不确定性，不能当成已发布事实。`;
  await plan(choose,`${userDemand}\n实际榜单：${JSON.stringify(discovered.signals)}。选择后搜索原始公告和独立报道，不以宽泛年度综述代替新闻。`,()=>Boolean(selection));
  let raw:ResearchResult|undefined;
  const failures=[...discovered.failures],readReferences=new Map<string,ResearchReference>(),searched=new Set<string>();
  let references:ResearchReference[]=[];
  const brief:HotResearchBrief={asOf,expiresAt,windowHours,signals:discovered.signals,topics:[],failures};
  for(let round=0;round<2;round++){
    if(round){
      selection=undefined;
      await plan({...choose,name:'refine_news_search',label:'补查新闻来源',execute:async(id,args)=>{
        if((args as {queries:string[]}).queries.every(q=>searched.has(q)))throw new Error('补查必须更换查询或来源，不能重复全部失败查询。');
        return choose.execute(id,args);
      }},`${userDemand}\n前次未找到合格选题。换查询、域名或检索传闻核验与官方状态；不能重复失败网页或改变主题。已搜索：${JSON.stringify([...searched])}；已读资料：${JSON.stringify(references.map(({excerpt,...r})=>r))}；实际缺口：${JSON.stringify(failures.slice(-12))}。`,()=>Boolean(selection));
    }
    const queries=selection!.queries;queries.forEach(q=>searched.add(q));
    const searches=await Promise.allSettled(queries.map(query=>trace.run('search_news','检索新闻与一手来源',{query,windowHours,asOf,attempt:round+1},()=>(options.search||researchGaps)(config,query,[`北京时间当前日期${new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'})}，近${windowHours}小时`,`同一事件至少两家发布者的新闻正文或官方公告；列出实际链接和日期`],'news'))));
    // Reserve source slots for each query so one cannot crowd out the other.
    let candidates:ResearchResult|undefined;
    for(const result of searches){if(result.status==='fulfilled')candidates=mergeResearch(candidates,{...result.value,references:result.value.references.slice(0,6)});else failures.push(result.reason instanceof Error?result.reason.message:'新闻搜索失败');}
    if(candidates)raw=mergeResearch(raw,candidates);
    const unread=candidates?.references.filter(r=>!readReferences.has(r.url))||[];
    const verified=await trace.run('read_news_sources','读取正文与发布时间',{urls:unread.map(r=>r.url),windowHours,attempt:round+1},()=>verifyNewsPages(unread,windowHours,options.read));
    failures.push(...verified.failures);
    verified.references.forEach(r=>readReferences.set(r.url,r));
    references=[...readReferences.values()].map((r,i)=>({...r,id:`ref-${i+1}`}));
    if(references.some(r=>r.freshness==='fresh')&&new Set(references.map(r=>newsPublisher(r.url))).size>=2){
      let submitted=false;
      const tool:AgentTool={name:'propose_hot_brief',label:'提炼有证据的热点选题',description:'用实际新闻正文提交最多3个选题；每题仅1–4条核心事实，跨发布者、至少1个新稿。每条事实只选择1–3个passageId，精简事实以适配证据数量；程序保存来源与原话，不另写referenceId或摘录。热度仅放在signalIds，不作为facts证据。证据不足时返回topics:[]，不要提交空facts的选题。',parameters:hotBriefParameters(references),execute:async(_id,args)=>{
        brief.topics=validateHotBrief(hydrateHotEvidence((args as {topics:any[]}).topics,references),references,discovered.signals);submitted=true;
        return {content:[{type:'text',text:JSON.stringify(brief.topics)}],details:brief.topics};
      }};
      const sources=references.map(({excerpt,...ref})=>({...ref,passages:newsPassages({...ref,excerpt})}));
      await plan(tool,`${userDemand}\n当前UTC ${asOf}。不得声称新闻发生于抓取日期；只有publishedAt是原文发布日期，eventDate须依据正文。制作角度是建议，不能写成事实或保证爆款。每题只提交1–4条核心事实，至少两家发布者。每条事实最多1–3个正文片段，超出时精简事实，只保留核心信息。evidence只填写已读正文的passageId，程序补全来源与逐字引文；不要填写referenceId。榜单编号baidu/hn只放在signalIds，不能写入evidence；热度、排名和抓取时间不要作为facts。标题与钩子也应遵循正文证据。可以区分新报道与旧背景。只使用以下已读正文，不使用以前搜索摘要的编号或事实。\n实际已读来源（以下ref-ID与passage-ID为唯一映射）：${JSON.stringify(sources)}\n真实热度信号：${JSON.stringify(discovered.signals.filter(s=>selection!.signalIds.includes(s.id)))}`,()=>submitted);
    }
    if(brief.topics.length)break;
    failures.push(`第${round+1}轮未找到时效与交叉证据同时合格的选题，继续锁定原主题补查。`);
  }
  if(!brief.topics.length)failures.push('本次缺少时效与交叉来源同时满足的选题；不能生成今日热点事实性脚本。');
  const requested=/(\d+)\s*个.{0,25}选题/.exec(prompt);
  if(requested&&brief.topics.length<Number(requested[1]))failures.push(`用户希望${requested[1]}个选题，本次仅${brief.topics.length}个通过证据校验；没有凑数，其他候选仍需补充可读来源。`);
  return {summary:`热点研究截止UTC ${asOf}（北京时区理解今日），新闻窗口${windowHours}小时，榜单热度与新闻事实分开记录。\n可制作选题及实际证据：\n${JSON.stringify(brief.topics)}\n实际已读来源与日期：\n${JSON.stringify(references)}\n限制：${failures.join('；')}`,references,queries:raw?.queries||[],usage:raw?.usage,current:brief};
}
