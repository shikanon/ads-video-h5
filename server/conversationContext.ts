import type { ChatMessage } from '../shared/types';
// Keep early role/format instructions alongside the recent conversation. A
// deterministic context does not invent memories or require another paid call.
export function conversationContext(history:ChatMessage[],limit=100000):string {
  const recent=history.slice(-40),early=history.slice(0,Math.max(0,history.length-40)).filter(m=>m.role==='user');
  const prefix=early.map(m=>`用户早期设定（${m.id}）：${m.text}`).join('\n');
  const latest=recent.map(m=>`${m.role}：${m.text}`).join('\n');
  const reserved=Math.min(40000,Math.floor(limit*.4));
  return (prefix?prefix.slice(0,reserved)+'\n较早设定用于保持角色、关系、文风；后续用户修改优先。\n':'')+latest.slice(-(limit-(prefix?reserved:0)));
}
