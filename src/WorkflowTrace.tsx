import type { WorkflowEvent } from './types';

export function WorkflowTrace({events}:{events?:WorkflowEvent[]}){
  if(!events?.length)return null;
  return <details className="workflow-trace">
    <summary>工具调用记录 · {events.length} 次</summary>
    <small>展示实际工具输入、结果与耗时；不包含模型内部推理。</small>
    {events.map((event,i)=><details key={event.callId||`${event.tool}-${i}`}>
      <summary>{i+1}. {event.stage} · {event.status==='succeeded'?'完成':event.status==='failed'?'失败':'进行中'}{event.durationMs!==undefined?` · ${(event.durationMs/1000).toFixed(1)}秒`:''}</summary>
      <code>{event.tool}</code>
      {event.detail?<p>{event.detail}</p>:null}
      {event.input!==undefined?<><strong>输入</strong><pre>{JSON.stringify(event.input,null,2)}</pre></>:null}
      {event.output!==undefined?<><strong>结果</strong><pre>{JSON.stringify(event.output,null,2)}</pre></>:null}
    </details>)}
  </details>;
}
