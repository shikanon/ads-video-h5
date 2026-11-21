import type {Session} from '../shared/types';
import type {ToolCanvas,ToolWorkspace} from '../shared/toolWorkspace';
export interface CanvasProfile {toolCanvases?:Partial<Record<'stickers'|'video',ToolCanvas>>}
/** Legacy projects migrate into one account space per category. Positions and
 * intentional removals remain intact; viewport visibility never deletes nodes. */
export function accountCanvases(profile:CanvasProfile,sessions:Session[]){
 const result:Partial<Record<'stickers'|'video',ToolCanvas>>={...profile.toolCanvases};
 for(const category of ['stickers','video'] as const){if(result[category])continue;const spaces=sessions.filter(s=>s.toolWorkspace?.category===category).sort((a,b)=>a.toolWorkspace!.updatedAt.localeCompare(b.toolWorkspace!.updatedAt));if(!spaces.length)continue;const nodes=new Map();for(const s of spaces)for(const n of s.toolWorkspace!.nodes)nodes.set(n.id,n);const last=spaces.at(-1)!.toolWorkspace!;result[category]={version:1,nodes:[...nodes.values()],camera:last.camera,updatedAt:last.updatedAt};}
 return result;
}
export function saveAccountCanvas(profile:CanvasProfile,w:ToolWorkspace){profile.toolCanvases={...profile.toolCanvases,[w.category]:{version:1,nodes:structuredClone(w.nodes),camera:w.camera&&{...w.camera},updatedAt:w.updatedAt}};}
