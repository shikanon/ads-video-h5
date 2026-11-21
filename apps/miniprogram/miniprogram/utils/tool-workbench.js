const {mediaView,artifactView,active}=require('./view');
const {skillStarters}=require('./templates');
const {isProduction}=require('./media-collections');
const builtinCatalog=require('./tool-catalog');
function thumbnail(t,client){
  const local=builtinCatalog.find(c=>c.id===t.id);if(local)return local.localThumbnail;
  const route=t.tool&&t.tool.thumbnailUrl||(t.output==='sticker-pack'?'/api/sticker-styles/lightmao':'/api/templates/'+t.id+'/sample/poster');
  return client.templateAssetUrl&&client.templateAssetUrl(route)||client.mediaUrl&&client.mediaUrl(route)||'';
}
function cards(templates,client){
  return (templates||[]).map(t=>({id:t.id,name:t.output==='sticker-pack'?'轻喵画风':t.name,category:t.tool&&t.tool.category|| (t.output==='sticker-pack'?'stickers':'video'),group:t.tool&&t.tool.group||'diagram',prompt:t.tool&&t.tool.prompt||(builtinCatalog.find(c=>c.id===t.id)||{}).tool?.prompt||'@'+t.name+' 主题/要求：【填写】',thumbnail:thumbnail(t,client),sticker:t.output==='sticker-pack',output:t.output||'video',icon:t.output==='sticker-pack'?'create':'films'})).concat((skillStarters||[]).filter(s=>!s.studioMode).map(s=>({id:s.id,name:s.name,category:'video',group:s.category==='mv'?'mv':s.category==='editing'?'editing':'diagram',prompt:s.prompt,thumbnail:'',icon:s.icon,starter:true})));
}
function nodeViews(session,state,projects,client,category){
  const w=session&&session.toolWorkspace||{},layouts=w.nodes||[],nodes=[],kind=category||w.category||'video',history=true;
  const add=(n,origin)=>{const l=layouts.find(l=>l.id===n.id);if(l&&l.hidden)return;const i=nodes.length;nodes.push(Object.assign({x:8+i%2*146,y:8+Math.floor(i/2)*190,width:128,height:168,scale:1,z:i+1},origin||{},n,l||{},{cover:n.cover||'',coverSource:n.coverSource||''}));};
  const ids=new Set([...(w.attachmentIds||[]),...layouts.filter(l=>l.sourceKind==='media').map(l=>l.sourceId)]);
  for(const m of state.media||[])if(ids.has(m.id)||history&&m.origin==='generated'&&!isProduction(m)&&!(state.artifacts||[]).some(a=>a.mediaId===m.id)&&(kind==='stickers'?m.character&&m.character.role==='sprite':!m.character)){const v=mediaView(m,client);add({id:'media-'+m.id,sourceId:m.id,sourceKind:'media',label:m.name,kind:m.kind,coverSource:v.coverSource,cover:v.cover});}
  const occurrences={};
  for(const a of state.artifacts||[]){const linked=layouts.some(l=>l.sourceKind==='artifact'&&l.sourceId===a.id),same=session&&a.sessionId===session.id,match=kind==='stickers'?a.kind==='sticker-pack':a.kind!=='sticker-pack';if(!linked&&!same&&!(history&&match))continue;
    const v=artifactView(a,client),job=(state.jobs||[]).find(j=>j.artifactId===a.id||j.sessionId===a.sessionId&&j.messageId===a.messageId),pos=job&&job.toolPlacement;let origin;if(pos){const at=occurrences[job.id]||0;occurrences[job.id]=at+1;origin={x:pos.x+at*24,y:pos.y+at*24};}
    add({id:'artifact-'+a.id,sourceId:a.id,sourceKind:'artifact',label:a.name,kind:a.kind,coverSource:v.coverSource,cover:v.cover,artifactId:a.id,sessionId:a.sessionId},origin);
  }
  for(const p of projects||[]){const same=session&&p.sessionId===session.id,linked=layouts.some(l=>l.sourceKind==='sticker'&&l.sourceId===p.id);if(!same&&!linked&&!(history&&kind==='stickers'))continue;
    for(const [i,c] of (p.styleCandidates||[]).entries())add({id:'sticker-'+p.id+'-'+c.id,sourceId:p.id,sourceKind:'sticker',itemId:c.id,label:c.id==='soft'?'柔彩':'圆萌',kind:'image',candidate:true,hash:c.hash,coverSource:c.previewUrl,locked:p.styleSelection&&p.styleSelection.id===c.id,sessionId:p.sessionId},p.canvasPosition&&{x:p.canvasPosition.x+i*146,y:p.canvasPosition.y});
    for(const [i,c] of (p.completed||[]).entries())add({id:'sticker-'+p.id+'-'+c.id,sourceId:p.id,sourceKind:'sticker',itemId:c.id,label:c.name||'动作'+c.id,kind:'image',coverSource:c.thumbnailUrl,previewUrl:c.previewUrl,sessionId:p.sessionId},p.canvasPosition&&{x:p.canvasPosition.x+i%4*146,y:p.canvasPosition.y+190+Math.floor(i/4)*190});
  }
  return nodes.slice(-5000);
}
function nodeLayout(n){return {id:n.id,sourceId:n.sourceId,sourceKind:n.sourceKind,...(n.itemId?{itemId:n.itemId}:{}),x:n.x,y:n.y,width:n.width,height:n.height,...(n.hidden?{hidden:true}:{}),...(n.scale&&n.scale!==1?{scale:n.scale}:{}),...(n.z?{z:n.z}:{})};}
function workspace(category,templateId,draft,attachmentIds,nodes,output,camera,nextPosition,includeHistory,mvSettings){return {...(mvSettings?{mvSettings}:{}),version:1,output:output||'static',category,templateId:templateId||null,draft:draft||'',attachmentIds:attachmentIds||[],nodes:(nodes||[]).map(nodeLayout),...(camera?{camera}:{}) ,...(nextPosition?{nextPosition}:{}),includeHistory:includeHistory!==false};}
function projectRows(state,projects){
  return (state.sessions||[]).filter(s=>!s.archivedAt&&!s.toolBatchId&&(s.toolWorkspace||(state.artifacts||[]).some(a=>a.sessionId===s.id)||(projects||[]).some(p=>p.sessionId===s.id))).map(s=>({id:s.id,name:s.title,category:s.toolWorkspace&&s.toolWorkspace.category||((projects||[]).some(p=>p.sessionId===s.id)?'stickers':'video'),count:(state.artifacts||[]).filter(a=>a.sessionId===s.id).length}));
}
function running(state,id){return (state.jobs||[]).find(j=>j.sessionId===id&&active(j));}
module.exports={cards,nodeViews,nodeLayout,workspace,running,builtinCatalog,projectRows};
