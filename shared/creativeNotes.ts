export interface CreativeNote {
 id:string;ownerId:string;title:string;text:string;kind:'note'|'template'|'mv';attachmentIds:string[];
 strokes:Array<Array<{x:number;y:number}>>;revision:number;createdAt:string;updatedAt:string;
 sourceArtifactId?:string;sessionId?:string;
}
