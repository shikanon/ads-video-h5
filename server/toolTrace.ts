import { randomUUID } from 'node:crypto';
import type { Agent, AgentTool } from '@earendil-works/pi-agent-core';
import type { WorkflowEvent } from '../src/types';

// Persist executable decisions and tool I/O, never hidden model reasoning,
// credentials or media payloads. Bounds also protect state polling responses.
export function traceValue(value: unknown, secrets: string[]=[], depth=0): unknown {
  if(depth>5)return '[depth limited]';
  if(value instanceof Uint8Array)return `[media omitted: ${value.byteLength} bytes]`;
  if(typeof value==='string'){
    let text=value;for(const secret of secrets)if(secret.length>=6)text=text.replaceAll(secret,'[redacted]');
    text=text.replace(/Bearer\s+[\w.+/=-]+/gi,'Bearer [redacted]').replace(/data:(?:audio|image)\/[^;]+;base64,[\w+/=]+/gi,'[media omitted]');
    return text.length>2400?text.slice(0,2400)+'… [truncated]':text;
  }
  if(Array.isArray(value))return value.slice(0,32).map(v=>traceValue(v,secrets,depth+1));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).slice(0,40).map(([k,v])=>[k,/api.?key|authorization|password|secret|token|base64|audio_data|ciphertext/i.test(k)?'[redacted]':traceValue(v,secrets,depth+1)]));
  return value;
}

export function createToolTrace(publish:(events:WorkflowEvent[])=>Promise<void>,secrets:string[]=[],events:WorkflowEvent[]=[]) {
  return {
    events,
    async run<T>(tool:string,stage:string,input:unknown,execute:()=>Promise<T>,callId:string=randomUUID()):Promise<T>{
      const start=Date.now();const event:WorkflowEvent={tool,stage,callId,status:'running',at:new Date().toISOString(),input:traceValue(input,secrets)};
      events.push(event);await publish(events);
      try{const result=await execute();event.status='succeeded';event.output=traceValue(result,secrets);return result;}
      catch(error){event.status='failed';event.detail=String(traceValue(error instanceof Error?error.message:String(error),secrets));throw error;}
      finally{event.durationMs=Date.now()-start;await publish(events);}
    },
    wrap(tools:AgentTool[]):AgentTool[]{return tools.map(tool=>({...tool,execute:async(...args:Parameters<AgentTool['execute']>)=>this.run(tool.name,tool.label,args[1],()=>tool.execute(...args),args[0])}));},
  };
}

export function observeToolErrors(agent:Agent,trace:ReturnType<typeof createToolTrace>){
  const started=new Map<string,unknown>();const pending:Promise<unknown>[]=[];
  const unsubscribe=agent.subscribe(e=>{
    if(e.type==='tool_execution_start')started.set(e.toolCallId,e.args);
    if(e.type==='tool_execution_end'&&e.isError&&!trace.events.some(v=>v.callId===e.toolCallId)){
      const detail=(e.result?.content||[]).filter((c:any)=>c.type==='text').map((c:any)=>c.text).join('\n')||'工具参数被框架拒绝。';
      pending.push(trace.run(e.toolName,'校验工具参数',started.get(e.toolCallId),async()=>{throw new Error(detail);},e.toolCallId).catch(()=>{}));
    }
  });
  return async()=>{unsubscribe();await Promise.allSettled(pending);};
}
