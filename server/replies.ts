import { randomUUID } from 'node:crypto';
import type { ChatMessage, Job, ReplyPart, Session, WorkflowEvent } from '../src/types';
import { throwIfJobCancelled } from './jobExecution';

export function updateReply(session: Session, job: Job, text: string, phase: ReplyPart['phase']='final', partId:string=phase, artifactId?: string): ChatMessage {
  throwIfJobCancelled();
  let reply=session.messages.find(m=>m.role==='assistant'&&m.jobId===job.id);
  if(!reply){reply={id:randomUUID(),role:'assistant',text:'',createdAt:new Date().toISOString(),jobId:job.id,parts:[]};session.messages.push(reply);}
  reply.parts ||= [];
  const existing=reply.parts.find(p=>p.id===partId);
  if(existing){existing.text=text;existing.phase=phase;}
  else reply.parts.push({id:partId,phase,text,createdAt:new Date().toISOString()});
  // Keep the compatibility field and model history concise. Commentary is
  // displayable progress, never replayed to the model as another instruction.
  if(phase==='final')reply.text=text;
  if(artifactId)reply.artifactIds=[...new Set([...(reply.artifactIds||[]),artifactId])];
  return reply;
}

const stages:Record<string,[string,string]>={
  transcribe_sources:['正在听取素材，整理原话和时间码。','素材原话和时间码已整理，继续选择有价值的观点。'],
  read_transcript:['正在查找与主题相关的完整原句。','原话检索已完成，继续核对可用句子。'],
  select_scenes:['正在选择分镜，核对原话完整性和剪切位置。','分镜已选定，原话、时间码和选择理由已保留。'],
  inspect_scenes:['正在查看分镜画面，检查构图和可用区域。','画面检查已完成，接下来编写叙事脚本。'],
  write_narrative:['正在整理观点、论据和结论，编写叙事脚本。','叙事脚本已整理，准备编排画面。'],
  research_gaps:['正在联网查证素材缺少的信息。','已取得带来源的补充资料。'],
  write_rebuilt_script:['正在重新组织原话和画面，编写制片脚本。','制片脚本已完成，准备生成分镜。'],
  prepare_voice:['正在提取已授权的声音参考。','声音参考已准备好。'],
  produce_scenes:['正在绘制并渲染 HTML 分镜，核对实际音轨。','新分镜已生成，画面和音轨已核对。'],
  arrange_timeline:['正在编排时间线、字幕和声音。','时间线已编排，准备输出成片。'],
  render_edit:['正在渲染当前方案。','成片已渲染，接下来检查实际效果。'],
  review_edit:['正在检查成片画面、字幕和声音。','审查结果已记录，未通过项会在总结中说明。'],
  repair_scenes:['正在按审查结果修正分镜。','返修方案已处理，未解决的问题会保留在审查结果中。'],
  refine_script:['正在调整脚本和实测时长。','脚本调整已完成。'],
};
export function recordWorkflowReply(session:Session,job:Job,events:WorkflowEvent[]) {
  // Event index distinguishes retries and repairs. Updating that part preserves
  // the chronology without appending the same polling update over and over.
  events.forEach((event,index)=>{
    const copy=stages[event.tool];
    const text=event.status==='failed'?`${event.stage}遇到问题，正在检查可否修正。${event.detail?'\n'+event.detail:''}`
      :copy?copy[event.status==='succeeded'?1:0]:`${event.stage}${event.status==='succeeded'?'已完成。':'正在进行。'}`;
    updateReply(session,job,text,'commentary',`workflow-${index}`);
  });
}
