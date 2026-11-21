export interface ToolBatch {
  id:string;ownerId:string;requestId:string;inputHash:string;name:string;templateId:string;templateName:string;
  attachmentIds:string[];position:{x:number;y:number};createdAt:string;
  items:Array<{topic:string;sessionId?:string;jobId?:string;error?:string;starting?:boolean}>;
}
export interface ToolBatchView {
  id:string;name:string;position:{x:number;y:number};templateId:string;templateName:string;createdAt:string;
  count:number;done:number;active:boolean;failed:number;
  items:Array<{index:number;topic:string;sessionId?:string;jobId?:string;status:string;error:string;unavailable:boolean}>;
}
