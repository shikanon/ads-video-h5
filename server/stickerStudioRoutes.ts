import type { Express } from 'express';
import path from 'node:path';
import { userOf, type PublicUser } from './auth';
import { validateStickerRecipe, type StickerStudio, type StickerRecipe } from './stickerStudio';
import type { StickerGenerationTask } from '../shared/stickerPacks';
const requestIdPattern=/^[a-zA-Z0-9_-]{16,80}$/;
export function mountStickerStudioRoutes(app:Express,o:{studio:StickerStudio;ready:()=>Promise<boolean>;
  start:(user:PublicUser,projectId:string,task:StickerGenerationTask)=>Promise<unknown>;
  reference:(user:PublicUser,sessionId:string,recipe:StickerRecipe)=>Promise<string>;
}) {
  const wrap=(action:(q:any,r:any)=>Promise<unknown>)=>async(q:any,r:any)=>{try{await action(q,r);}catch(error){const fsError=['ENOENT','EACCES','ENOTDIR'].includes((error as any).code);r.status(fsError?404:(error as any).status||400).json({error:fsError?'项目素材尚不可用，请刷新制作状态。':error instanceof Error?error.message:'表情制作未能开始。'});}};
  app.get('/api/sticker-projects/config',wrap(async(_q,r)=>r.json({available:await o.ready(),sampleCount:3,totalCount:24,modes:['static','dynamic']})));
  app.get('/api/sticker-projects',wrap(async(q,r)=>r.json({projects:await o.studio.list(userOf(q).id)})));
  app.post('/api/sticker-projects',wrap(async(q,r)=>{
    const {sessionId,requestId,recipe}=q.body||{};
    if(typeof sessionId!=='string'||!/^[a-f0-9-]{36}$/.test(sessionId)||typeof requestId!=='string'||!requestIdPattern.test(requestId)||Object.keys(q.body).some(k=>!['sessionId','requestId','recipe'].includes(k)))throw Error('表情项目请求无效。');
    if(!await o.ready())throw Error('请先请管理员配置可生成透明PNG的图片模型。');
    const checked=validateStickerRecipe(recipe),user=userOf(q),hash=await o.reference(user,sessionId,checked);
    const project=await o.studio.create(user.id,sessionId,requestId,checked,hash);
    const receipt=await o.start(user,project.id,{projectId:project.id,phase:'samples',makeVideo:false,bgm:false});
    r.status(202).json({project:await o.studio.view(user.id,project.id),state:receipt});
  }));
  app.get('/api/sticker-projects/:id',wrap(async(q,r)=>r.json({project:await o.studio.view(userOf(q).id,q.params.id)})));
  app.post('/api/sticker-projects/:id/approve',wrap(async(q,r)=>{
    const {previewHash,makeVideo,bgm}=q.body||{};
    if(typeof previewHash!=='string'||!/^[a-f0-9]{64}$/.test(previewHash)||typeof makeVideo!=='boolean'||typeof bgm!=='boolean'||Object.keys(q.body).some(k=>!['previewHash','makeVideo','bgm'].includes(k)))throw Error('请查看样张并选择制作选项。');
    const user=userOf(q);await o.studio.approve(user.id,q.params.id,previewHash);
    r.status(202).json({state:await o.start(user,q.params.id,{projectId:q.params.id,phase:'batch',approvalHash:previewHash,makeVideo,bgm}),project:await o.studio.view(user.id,q.params.id)});
  }));
  app.get('/api/sticker-projects/:id/items/:itemId/:kind',wrap(async(q,r)=>{
    const user=userOf(q);await o.studio.load(user.id,q.params.id);
    if(!/^\d{2}$/.test(q.params.itemId)||Number(q.params.itemId)<1||Number(q.params.itemId)>24)throw Object.assign(Error('动作不存在。'),{status:404});
    const file=({thumb:'thumb.png',preview:'animation.gif',still:'still.png'} as Record<string,string>)[q.params.kind];
    if(!file)throw Object.assign(Error('预览不存在。'),{status:404});
    r.setHeader('Cache-Control','private, no-store');r.sendFile(path.join(o.studio.folder(user.id,q.params.id),'assets','pack',q.params.itemId,file));
  }));
  app.get('/api/sticker-projects/:id/poster',wrap(async(q,r)=>{const user=userOf(q);await o.studio.pack(user.id,'custom-'+q.params.id);r.setHeader('Cache-Control','private, no-store');r.sendFile(path.join(o.studio.folder(user.id,q.params.id),'assets','poster.png'));}));
}
