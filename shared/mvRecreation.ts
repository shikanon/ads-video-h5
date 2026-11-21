export interface MvShot {sourceId:string;start:number;duration:number;chapter:string;reason:string;transition:'cut'|'fade'}
export interface MvCaption {start:number;end:number;text:string;kind?:'story'|'lyric';words?:Array<{start:number;end:number;text:string}>}
export interface MvPlan {story:string;shots:MvShot[];captions:MvCaption[];limitations:string[];subtitleStyle?:'standard'|'cinematic'}
export interface MvRecreation {
 id:string;ownerId:string;sessionId:string;name:string;referenceId:string;audioId:string;sourceIds:string[];
 duration:number;instructions:string;createdAt:string;updatedAt:string;plan?:MvPlan;planHash?:string;
 nodeArtifacts?:Record<string,string>;requests?:Record<string,string>;evidence?:Record<string,{sha256:string;description:string}>;approvedHash?:string;artifactId?:string;previewArtifactId?:string;
 lyricDraft?:{audioHash:string;captions:MvCaption[];timing:'model-estimated';warnings:string[]};
}
