import {createHash} from 'node:crypto';
import type {Job} from '../shared/types';
// Serialize only duplicate submissions; different conversations remain independent.
export function createChatSubmissions(){
  const pending=new Map<string,Promise<unknown>>();
  return async<T>(jobs:Job[],ownerId:string,sessionId:string,requestId:unknown,payload:unknown,run:()=>Promise<T>,replay:()=>Promise<T>):Promise<T>=>{
    if(requestId===undefined)return run();
    if(typeof requestId!=='string'||!/^[\w-]{8,100}$/.test(requestId))throw Object.assign(Error('提交凭证无效。'),{status:400});
    const key=ownerId+':'+requestId,hash=createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    const prior=pending.get(key);if(prior)await prior.catch(()=>{});
    const old=jobs.find(j=>j.ownerId===ownerId&&j.clientRequestId===requestId);
    if(old){if(old.sessionId!==sessionId||old.clientRequestHash!==hash)throw Object.assign(Error('提交内容已变化，请重新发送。'),{status:409});return replay();}
    const task=run();pending.set(key,task);try{return await task;}finally{if(pending.get(key)===task)pending.delete(key);}
  };
}
