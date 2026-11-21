export interface MvRect {x:number;y:number;width:number;height:number}
export interface MvSourceTreatment {speed:number;grade:'warm'|'cool';crops:MvRect[];delogo?:MvRect;preparedImageId?:string;zoom?:'in'|'out'}
export interface MvReferenceEdit {version:1;canvas:[number,number];picture:MvRect;dissolveFrames:number;fadeInFrames:number;fadeOutFrames:number;titleTrackId?:string;audioFadeOutFrames:number;copyAudio?:boolean}
export interface MvShot {sourceId:string;start:number;duration:number;chapter:string;reason:string;transition:'cut'|'fade';treatment?:MvSourceTreatment}
export interface MvCaption {start:number;end:number;text:string;kind?:'story'|'lyric';words?:Array<{start:number;end:number;text:string}>}
export interface MvPlan {story:string;shots:MvShot[];captions:MvCaption[];limitations:string[];subtitleStyle?:'standard'|'cinematic';referenceEdit?:MvReferenceEdit}
export interface MvRecreation {
 sourceFolderId?:string;createdFromRequestId?:string;
 id:string;ownerId:string;sessionId:string;name:string;referenceId:string;audioId:string;sourceIds:string[];
 duration:number;instructions:string;createdAt:string;updatedAt:string;plan?:MvPlan;planHash?:string;
 nodeArtifacts?:Record<string,string>;requests?:Record<string,string>;evidence?:Record<string,{sha256:string;description:string}>;approvedHash?:string;artifactId?:string;previewArtifactId?:string;
 lyricDraft?:{audioHash:string;captions:MvCaption[];timing:'model-estimated';warnings:string[]};
}
