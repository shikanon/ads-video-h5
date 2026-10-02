import type { ChatMessage } from './types';

const date=(value:string)=>/^\d{4}-\d{2}-\d{2}$/.test(value)?value:new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
export default function HotResearchCard({research}: {research:NonNullable<ChatMessage['research']>}) {
  const {brief,references}=research;
  return <section className="hot-research-card" aria-label="热点选题与来源">
    <div className="hot-research-heading"><strong>热点选题</strong><small>资料截止 {date(brief.asOf)}（北京时间）</small></div>
    {brief.topics.map((topic,index)=><details className="hot-topic" key={topic.title}>
      <summary><span>{index+1}. {topic.title}</span><small>{topic.signalIds.length?'有榜单信号':'最新新闻选题'}</small></summary>
      <p><b>开场：</b>{topic.hook}</p><p><b>角度：</b>{topic.angle}</p><p><b>画面：</b>{topic.visualPlan}</p>
      {topic.facts.map((fact,i)=><div className="hot-fact" key={i}><p>{fact.text}</p>{fact.evidence.map((e,j)=>{
        const ref=references.find(r=>r.id===e.referenceId);return ref?<div key={j}><blockquote>{e.quote}</blockquote><a href={ref.url} target="_blank" rel="noopener noreferrer">[{ref.id}] {ref.title}</a><small>{ref.publishedAt?`发布 ${date(ref.publishedAt)}`:'原文发布日期不明'} · {ref.freshness==='fresh'?'时效窗口内':ref.freshness==='stale'?'旧稿背景':'背景资料'}</small></div>:null;
      })}</div>)}
      {topic.signalIds.map(id=>{const s=brief.signals.find(v=>v.id===id);return s?<p className="hot-signal" key={id}><a href={s.boardUrl} target="_blank" rel="noopener noreferrer">{s.source==='baidu'?'百度热搜':'Hacker News'}</a> · {s.pinned?'置顶':`榜单第${s.rank}位`}{s.metric?` · ${s.metric.label} ${s.metric.value}`:''} · 观察 {date(s.observedAt)}</p>:null;})}
      {topic.uncertainties.length?<p><b>仍未知：</b>{topic.uncertainties.join('；')}</p>:null}
    </details>)}
    {brief.failures.length?<details className="hot-limitations"><summary>来源缺口与限制 · {brief.failures.length} 项</summary>{brief.failures.map((f,i)=><p key={i}>{f}</p>)}</details>:null}
  </section>;
}
