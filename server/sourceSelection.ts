import type { ChatMessage, EditPlan, MediaItem } from '../src/types';
export function sessionSources(prompt:string,media:MediaItem[],attached:MediaItem[],plan:EditPlan|null,history:ChatMessage[]):MediaItem[]{
  media=media.filter(m=>!m.character);
  attached=attached.filter(m=>!m.character);
  if(attached.length)return attached;
  if(plan&&!plan.lesson)return [...new Set(plan.clips.map(c=>c.sourceId))].map(id=>media.find(m=>m.id===id)).filter((m):m is MediaItem=>Boolean(m));
  const ids=[...history].reverse().find(m=>m.role==='user'&&m.attachmentIds?.length)?.attachmentIds;
  if(ids)return media.filter(m=>ids.includes(m.id));
  // Shared availability is not selection. An empty new chat must not silently
  // read old recordings or feed generated revisions back as source evidence.
  return /素材库|全部素材|所有素材/.test(prompt)?media.filter(m=>m.origin!=='generated'):[];
}
