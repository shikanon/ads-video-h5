export interface ToolNode {
  id:string; sourceId:string; sourceKind:'media'|'artifact'|'sticker'; itemId?:string;
  x:number; y:number; width:number; height:number; hidden?:boolean; scale?:number; z?:number;
}
export interface ToolWorkspace {
  mvSettings?:{folderId:string;audioId:string;duration:number;resolution:480|720|1080};
  output?: 'static' | 'dynamic';
  version:1; category:'stickers'|'video'; templateId:string|null; draft:string;
  attachmentIds:string[]; nodes:ToolNode[]; updatedAt:string;
  camera?: {x:number;y:number;zoom:number};
  nextPosition?: {x:number;y:number};
  includeHistory?: boolean;
}
export type ToolCanvas=Pick<ToolWorkspace,'version'|'nodes'|'camera'|'updatedAt'>;
