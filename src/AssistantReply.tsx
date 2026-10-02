import { ChevronDown } from 'lucide-react';
import type { ChatMessage, Job } from './types';

function Paragraphs({text}:{text:string}) {
  return <>{text.split(/\n\s*\n/).filter(Boolean).map((paragraph,index)=><p key={index}>{paragraph.split(/(\*\*[^*]+\*\*)/g).map((part,i)=>part.startsWith('**')&&part.endsWith('**')?<strong key={i}>{part.slice(2,-2)}</strong>:part)}</p>)}</>;
}

function ReplyText({text,locale}:{text:string;locale:string}) {
  if(text.length<=420)return <div className="reply-text"><Paragraphs text={text}/></div>;
  // Legacy long replies remain available. This is an exact excerpt, not an
  // invented model summary, and the complete text is never discarded.
  const excerpt=text.split('\n')[0].slice(0,180);
  return <div className="reply-text">
    <p>{excerpt}…</p>
    <details className="reply-full"><summary>{locale==='zh-CN'?'查看完整内容':'Read full response'}<ChevronDown size={14} aria-hidden="true"/></summary><Paragraphs text={text}/></details>
  </div>;
}

export default function AssistantReply({message,job,locale}:{message:ChatMessage;job?:Job;locale:string}) {
  const commentary=message.parts?.filter(p=>p.phase==='commentary')||[];
  const final=(message.parts?.find(p=>p.phase==='final')?.text||message.text).replace(/^(?:总结|小结|Summary)[：:]\s*/i,'');
  const complete=job?job.status==='succeeded'||job.status==='failed':Boolean(final);
  if(!commentary.length)return final?<div className="message-bubble"><ReplyText text={final} locale={locale}/></div>:null;
  return <div className="assistant-reply">
    <details key={complete?'finished':'in-progress'} className={`reply-process ${complete?'finished':'active'}`} open={!complete}>
      <summary><span>{locale==='zh-CN'?`处理过程 · ${commentary.length} 段`:`Progress · ${commentary.length} updates`}</span><ChevronDown size={15} className="disclosure-chevron" aria-hidden="true"/></summary>
      <div className="reply-updates">{commentary.map(part=><section className="reply-update" key={part.id}><ReplyText text={part.text} locale={locale}/></section>)}</div>
    </details>
    {final?<section className={`reply-final ${job?.status==='failed'?'failed':''}`} aria-label={locale==='zh-CN'?'最终总结':'Final summary'}>
      <span className="reply-final-label">{locale==='zh-CN'?(job?.status==='failed'?'本次结果':'总结'):(job?.status==='failed'?'Result':'Summary')}</span>
      <ReplyText text={final} locale={locale}/>
    </section>:null}
  </div>;
}
