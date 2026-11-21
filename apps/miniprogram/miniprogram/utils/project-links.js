function projectLinks(message,job,state){
  const links=[];
  if(job&&job.stickerGenerationTask)links.push({id:'sticker-'+job.stickerGenerationTask.projectId,label:job.status==='succeeded'?'查看表情项目':'打开表情项目',kind:'sticker',projectId:job.stickerGenerationTask.projectId,sessionId:job.sessionId});
  if(job&&job.mvTask)links.push({id:'mv-'+job.mvTask.projectId,label:'查看MV复刻项目',kind:'mv',projectId:job.mvTask.projectId});
  const ids=new Set([...(message.artifactIds||[]),...(job&&job.artifactId?[job.artifactId]:[])]);
  for(const a of state.artifacts||[])if((ids.has(a.id)||a.messageId===message.id||job&&a.sessionId===job.sessionId&&a.messageId===job.messageId)&&(!job||!job.mvTask||ids.has(a.id)))links.push({id:a.id,label:'查看'+(a.kind==='sticker-pack'?'表情作品':a.kind==='game'?'交互作品':'制作结果'),kind:'artifact',artifactId:a.id,sessionId:a.sessionId});
  const session=job&&(state.sessions||[]).find(s=>s.id===job.sessionId);
  if(session&&session.toolWorkspace)links.push({id:'workspace-'+session.id,label:'返回项目画布',kind:'workspace',sessionId:session.id,category:session.toolWorkspace.category});
  for(const n of state.creativeNoteLinks||[])if(job&&n.sessionId===job.sessionId)links.push({id:'note-'+n.id,label:'返回创作笔记',kind:'creative',noteId:n.id});
  return links;
}
function openProject(link){if(!link)return;const app=getApp();if(link.kind==='mv'){wx.navigateTo({url:'/pages/mv-recreate/index?projectId='+encodeURIComponent(link.projectId)});return;}if(link.kind==='creative'){wx.navigateTo({url:'/pages/creative-studio/index?noteId='+encodeURIComponent(link.noteId)});return;}if(link.kind==='sticker'){wx.navigateTo({url:'/pages/sticker-studio/index?sessionId='+encodeURIComponent(link.sessionId)+'&projectId='+encodeURIComponent(link.projectId)});return;}if(link.kind==='workspace'){app.pendingToolWorkspace={sessionId:link.sessionId,category:link.category};wx.switchTab({url:'/pages/templates/index'});return;}const artifact=app.state&&(app.state.artifacts||[]).find(a=>a.id===link.artifactId);if(artifact&&artifact.kind==='game'){wx.navigateTo({url:'/pages/player/index?type=artifact&id='+encodeURIComponent(artifact.id)});return;}wx.navigateTo({url:'/pages/player/index?type=artifact&id='+encodeURIComponent(link.artifactId)});}
module.exports={projectLinks,openProject};
