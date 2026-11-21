const { appearanceData } = require('../../utils/appearance');
const { withSession, hide, requireLogin, privacy, notify } = require('../../utils/page');
const { uploadMedia } = require('../../utils/upload');
const { mediaView, active, jobView } = require('../../utils/view');
const { loadThumbnails, coverError } = require('../../utils/thumbnails');
const { stickerTemplateShare } = require('../../utils/share');
const {prepareWorkShare,loadWorkShares,revokeWorkShares,workShare}=require('../../utils/sticker-work-share');
const { activateSession, openDraft } = require('../../utils/sessions');
function latestProjectJob(project,jobs){return project&&(jobs||[]).slice().reverse().find(job=>job.stickerGenerationTask&&job.stickerGenerationTask.projectId===project.id);}
function projectRow(project,jobs){
  const job=latestProjectJob(project,jobs),phase=job&&job.stickerGenerationTask.phase==='styles'?'候选画风':job&&job.stickerGenerationTask.phase==='batch'?'整套':'样张';
  const statusText=job&&job.status==='failed'?phase+'未完成':job&&job.status==='cancelled'?'已停止':job&&active(job)?phase+(job.status==='queued'?'排队中':'制作中'):project.ready?'整套已完成':project.approved?'已确认样张':project.previewHash?'待确认样张':project.styleCandidates&&project.styleCandidates.length===2&&!project.styleSelection?'待选择画风':'等待制作';
  return Object.assign({},project,{statusText});
}
Page({
  onShareAppMessage(event) {return workShare(event,this)||stickerTemplateShare(event);},
  data: Object.assign(appearanceData(), { mode:'dynamic', name:'', style:'保留角色原有发型、服装和配饰，先比较两种候选画风', references:[], referenceId:'', referenceName:'', available:false, pricing:null, quote:null, quoteError:'', checking:true, loading:false, submitting:false, uploading:false, makeVideo:false, bgm:false, projects:[], project:null, samples:[], selected:null, showTaskRecords:false, newSessionNeeded:false, error:'' }),
  onLoad(query) { this.setData({mode:query.mode==='static'?'static':'dynamic',fromTemplate:query.from==='template',styleId:['soft','round','lightmao','custom'].includes(query.styleId)?query.styleId:'lightmao',styles:[],shareToken:'',completed:[],balance:0});this._sessionId=query.sessionId||'';this._requestedProjectId=query.projectId||'';this._previewToken=0;this._loadToken=0;this._quoteToken=0; },
  onShow() {
    const app=getApp();
    if(this._generation!==app._generation){if(this._generation!==undefined){this._sessionId='';this._requestedProjectId='';}this._generation=app._generation;this._requestId='';this._fingerprint='';this._pollKey='';this._previewToken=(this._previewToken||0)+1;this.setData({referenceId:'',referenceName:'',name:'',style:'保留角色原有发型、服装和配饰，先比较两种候选画风',references:[],projects:[],project:null,projectJob:null,samples:[],selected:null,shareToken:'',sharing:false,showTaskRecords:false,newSessionNeeded:false,projectSessionUnavailable:false,error:'',submitting:false,uploading:false,available:false,pricing:null,quote:null,quoteError:'',checking:true});}
    if(withSession(this,this.render))this.load();
  },
  onHide(){hide(this);this._previewToken++;this.setData({selected:null});},onUnload(){hide(this);this._previewToken++;},
  onPullDownRefresh(){return this.load().finally(()=>wx.stopPullDownRefresh());},
  login(){if(!getApp().client.hasSession())wx.navigateTo({url:'/pages/auth/index?stickerMode='+(this.data.mode==='static'?'static':'dynamic')+'&stickerStyle='+(this.data.styleId||'soft')});},
  render(state){
    this.setData({balance:state.credits?.balance||0});
    const app=getApp();if(!this._sessionId)this._sessionId=state.activeSessionId;
    this.setData({references:(state.media||[]).filter(item=>item.kind==='image'&&['image/png','image/jpeg','image/webp'].includes(item.mimeType)).slice(-30).reverse().map(item=>mediaView(item,app.client))});loadThumbnails(this,'references',app.client);
    const jobs=(state.jobs||[]).filter(job=>job.stickerGenerationTask),busy=(state.jobs||[]).some(job=>active(job)&&job.sessionId===this._sessionId),key=jobs.map(job=>job.id+':'+job.status).join('|');
    this.setData({busy,projects:this.data.projects.map(project=>projectRow(project,state.jobs))});if(this._visible&&key!==this._pollKey){this._pollKey=key;this.load();}
    this.renderProjectJob();
  },
  async load(){
    if(!getApp().client.hasSession())return;
    const app=getApp(),generation=app._generation,token=this._loadToken=(this._loadToken||0)+1;this.setData({loading:true,error:''});
    try{
      const [config,response]=await Promise.all([app.client.request('/api/sticker-projects/config'),app.client.request('/api/sticker-projects')]);
      if(!this._visible||generation!==app._generation||token!==this._loadToken)return;
      const projects=response.projects.slice().sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(project=>projectRow(project,app.state&&app.state.jobs));
      this.setData({available:config.available,pricing:config.pricing||null,templateHash:config.templateHash||'',styles:(config.styles||[]).map(s=>Object.assign({},s,{sample:s.sampleUrl?app.client.mediaUrl(s.sampleUrl):''})),checking:false,projects,error:config.pricingError||''});
      const selected=projects.find(item=>item.id===(this.data.project&&this.data.project.id||this._requestedProjectId));if(selected){this._requestedProjectId='';this.showProject(selected);}
    }catch(error){if(this._visible&&generation===app._generation&&token===this._loadToken)this.setData({checking:false,error:error.message||'表情工坊需要更新后端后使用。'});}
    finally{if(generation===app._generation&&token===this._loadToken)this.setData({loading:false});}
  },
  coverError(event){coverError(this,'references',event,getApp().client);},
  mode(event){if(!this.data.submitting)this.setData({mode:event.currentTarget.dataset.mode,project:null,samples:[]});},
  name(event){this.setData({name:event.detail.value});},changeStyle(event){this.setData({style:event.detail.value});},
  chooseStyle(event){const style=this.data.styles.find(s=>s.id===event.currentTarget.dataset.id);if(style)this.setData({styleId:style.id,style:style.id==='custom'?'保留角色原有发型、服装和配饰':style.name+'，保留角色原有发型、服装和配饰'});},
  reference(event){const item=this.data.references.find(item=>item.id===event.currentTarget.dataset.id);if(item)this.setData({referenceId:item.id,referenceName:item.name});},
  async deleteReference(event){if(await require('../../utils/manage').deleteMedia(this,event.currentTarget.dataset.id))this.render(getApp().state);},
  async manageProject(event){const p=this.data.projects.find(p=>p.id===event.currentTarget.dataset.id)||this.data.project;if(!p||this.data.submitting)return;const app=getApp(),generation=app._generation;const choice=await new Promise(resolve=>wx.showActionSheet({itemList:['重命名','删除表情项目'],success:r=>resolve(r.tapIndex),fail:()=>resolve(-1)}));try{if(choice===0){const name=await require('../../utils/manage').editName('表情项目名称',p.recipe.name,40);if(name===null||generation!==app._generation)return;await app.client.request('/api/sticker-projects/'+p.id,{name},'PATCH');}if(choice===1){const ok=await new Promise(resolve=>wx.showModal({title:'删除表情项目？',content:'删除项目及表情套装，关闭预览与分享。已保存到手机的文件不受影响。',confirmText:'删除',success:r=>resolve(r.confirm),fail:()=>resolve(false)}));if(!ok||generation!==app._generation)return;await app.client.request('/api/sticker-projects/'+p.id,undefined,'DELETE');if(this.data.project&&this.data.project.id===p.id){this._requestedProjectId='';this._previewToken++;this.setData({project:null,samples:[],completed:[],selected:null,shareToken:'',quote:null});}await app.refresh();}if(generation===app._generation)await this.load();}catch(e){notify(e);}},
  video(event){this.setData({makeVideo:event.detail.value});},music(event){this.setData({bgm:event.detail.value});},
  async upload(){
    if(this.data.uploading||!requireLogin())return;const app=getApp(),generation=app._generation;this.setData({uploading:true,error:''});
    try{
      await privacy();const file=await new Promise((resolve,reject)=>wx.chooseMedia({count:1,mediaType:['image'],sizeType:['original'],sourceType:['album','camera'],success:result=>resolve(result.tempFiles[0]),fail:error=>/cancel/.test(error.errMsg||'')?resolve(null):reject(error)}));
      if(!file)return;if(file.size>20*1024*1024)throw Error('角色图片不能超过20MB。');
      const ids=await uploadMedia(app,[{path:file.tempFilePath,size:file.size}],()=>{});
      if(!this._visible||generation!==app._generation)return;const item=app.state.media.find(item=>item.id===ids[0]);
      if(item)this.setData({referenceId:item.id,referenceName:item.name});
    }catch(error){if(generation===app._generation)this.setData({error:error.message||error.errMsg||'角色上传未完成。'});}
    finally{if(generation===app._generation)this.setData({uploading:false});}
  },
  async start(){
    if(this.data.submitting||!requireLogin()||!this.data.available||!this.data.pricing)return;
    if(this.data.project){this.setData({error:'请在当前项目中重试，或先点“调整设定”返回编辑。'});return;}
    const app=getApp(),generation=app._generation;
    if(!app.state){this.setData({error:'正在同步会话，请稍后重试。'});return;}
    const recipe={referenceMediaId:this.data.referenceId,name:this.data.name.trim(),style:this.data.style.trim(),styleId:this.data.styleId||'lightmao',mode:this.data.mode,...(this.data.styleId==='lightmao'||!this.data.styleId?{styleSelection:'lightmao'}:{})};
    if(!recipe.referenceMediaId||!recipe.name||!recipe.style){this.setData({error:'请选择角色图，填写套装名称与画风。'});return;}
    if(recipe.styleSelection&&!Number.isFinite(this.data.pricing.styleCandidates)){this.setData({error:'候选画风制作暂不可用，请稍后刷新状态。已有作品仍可查看。'});return;}
    const cost=recipe.styleSelection?this.data.pricing.styleCandidates:recipe.mode==='static'?this.data.pricing.staticSamples:this.data.pricing.dynamicSamples;if(this.data.balance<cost){const error=new Error('本阶段需要'+cost+'积分，当前可用'+this.data.balance+'积分，请先到「我的积分」签到或查看余额。');this.setData({error:error.message});notify(error);return;}
    this.setData({submitting:true,error:''});
    try{
      let sessionId=this._sessionId;
      if(!(app.state.sessions||[]).some(session=>session.id===sessionId&&!session.archivedAt)){
        const draft=await openDraft(app,'work');if(generation!==app._generation||!this._visible)return;
        sessionId=draft._openedDraftId||draft.activeSessionId;this._sessionId=sessionId;this.setData({newSessionNeeded:false});
      }
      const fingerprint=JSON.stringify({sessionId,recipe});if(fingerprint!==this._fingerprint){this._fingerprint=fingerprint;this._requestId='sticker_studio_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2);}
      const response=await app.client.request('/api/sticker-projects',{sessionId,requestId:this._requestId,recipe,pricingHash:this.data.pricing.pricingHash});
      if(generation!==app._generation)return;(app.commit||app.apply).call(app,response.state);if(!this._visible)return;this.showProject(response.project);this.load();
    }catch(error){if(generation===app._generation)this.setData({error:error.message});}
    finally{if(generation===app._generation)this.setData({submitting:false});}
  },
  async selectCandidate(event){
    if(this.data.submitting||this.data.busy||!this.data.quote||!requireLogin())return;
    const app=getApp(),generation=app._generation,project=this.data.project,id=event.currentTarget.dataset.id,item=(project&&project.styleCandidates||[]).find(item=>item.id===id);
    if(!item)return;if(project.styleSelection&&project.styleSelection.id!==id){this.setData({error:'本项目已锁定画风。更换画风请调整设定，新建项目。'});return;}
    if(this.data.balance<this.data.quote.points){this.setData({error:'积分不足，本阶段需要'+this.data.quote.points+'积分，请先查看我的积分。'});return;}
    this.setData({submitting:true,error:''});
    try{const response=await app.client.request('/api/sticker-projects/'+project.id+'/style',{id,candidateHash:item.hash,pricingHash:this.data.quote.pricingHash});if(generation!==app._generation)return;(app.commit||app.apply).call(app,response.state);if(this._visible){this.showProject(response.project);this.load();}}
    catch(error){if(generation===app._generation)this.setData({error:error.message});}
    finally{if(generation===app._generation)this.setData({submitting:false});}
  },
  async previewCandidate(event){
    const item=(this.data.candidates||[]).find(item=>item.id===event.currentTarget.dataset.id);if(!item)return;
    const app=getApp(),generation=app._generation,token=++this._previewToken;
    try{const image=await app.client.download(item.previewUrl);if(this._visible&&generation===app._generation&&token===this._previewToken)this.setData({selected:image});}catch(error){if(generation===app._generation)this.setData({error:error.message});}
  },
  openProject(event){const project=this.data.projects.find(item=>item.id===event.currentTarget.dataset.id);if(project){this._sessionId=project.sessionId;this.showProject(project);this.render(getApp().state);}},
  showProject(project){
    const app=getApp(),generation=app._generation,token=++this._previewToken;this.setData(Object.assign({project,candidates:(project.styleCandidates||[]).map(item=>Object.assign({},item,{coverSource:item.previewUrl,cover:''})),samples:project.samples.map(item=>Object.assign({},item,{image:''})),completed:(project.completed||[]).map(item=>Object.assign({},item,{coverSource:item.thumbnailUrl,cover:''}))},!this.data.project||this.data.project.id!==project.id?{showTaskRecords:false,shareToken:''}:{}));loadThumbnails(this,'completed',app.client);loadThumbnails(this,'candidates',app.client);
    this.renderProjectJob();
    this.loadQuote(project);
    loadWorkShares(this,app);
    Promise.all(project.samples.map(async item=>{try{const image=await app.client.download(item.thumbnailUrl,{persistent:true});if(!this._visible||generation!==app._generation||token!==this._previewToken)return;this.setData({samples:this.data.samples.map(sample=>sample.id===item.id?Object.assign({},sample,{image}):sample)});}catch{ /* individual preview remains retryable */ }}));
  },
  async loadQuote(project){
    const app=getApp(),generation=app._generation,token=++this._quoteToken,job=latestProjectJob(project,app.state&&app.state.jobs),phase=job&&job.status==='failed'?job.stickerGenerationTask.phase:project.recipe.styleSelection&&!project.styleSelection&&(!project.styleCandidates||project.styleCandidates.length<2)?'styles':project.previewHash?'batch':'samples';this.setData({quote:null,quoteError:''});
    if(project.ready||job&&active(job))return;
    try{const quote=await app.client.request('/api/sticker-projects/'+project.id+'/quote?phase='+phase);if(this._visible&&generation===app._generation&&token===this._quoteToken&&this.data.project?.id===project.id)this.setData({quote});}
    catch(error){if(this._visible&&generation===app._generation&&token===this._quoteToken)this.setData({quoteError:error.message||'费用暂时无法读取，请刷新状态。'});}
  },
  renderProjectJob(){
    const project=this.data.project,state=getApp().state,jobs=state&&state.jobs||[],job=latestProjectJob(project,jobs),session=project&&state&&(state.sessions||[]).find(item=>item.id===project.sessionId),unavailable=Boolean(project&&(!session||session.archivedAt));
    const changed=Boolean(project&&project.compatible===false);
    this.setData({projectSessionUnavailable:unavailable,projectTemplateChanged:changed,projectSessionReason:session?'原会话已归档':'原会话已不存在',projectJob:job?{id:job.id,active:active(job),retryable:['failed','cancelled'].includes(job.status)&&job.failure?.retryable!==false&&job.failure?.code!=='STICKER_REFERENCE_UNSUITABLE'&&!JSON.stringify(job.failure||{}).includes('InputImageSensitiveContentDetected')&&job.cancelReason!=='superseded'&&!unavailable&&!changed,phase:job.stickerGenerationTask.phase,status:({queued:'排队中',running:'制作中',failed:'本阶段未完成',cancelled:'已停止',succeeded:'此阶段已完成'})[job.status]||job.status,stage:job.stage||'',error:job.error||'',workflow:jobView(job,this.data.showTaskRecords).workflow}:null});
  },
  async retry(){
    const job=this.data.projectJob;if(this.data.submitting||!job||!job.retryable||this.data.busy||!this.data.quote||!requireLogin())return;
    const app=getApp(),generation=app._generation,projectId=this.data.project.id;this.setData({submitting:true,error:''});
    try{await app.mutate('/api/jobs/'+encodeURIComponent(job.id)+'/retry',{pricingHash:this.data.quote.pricingHash});if(generation===app._generation&&this._visible&&this.data.project?.id===projectId){this.render(app.state);await this.load();}}
    catch(error){if(generation===app._generation&&this._visible){this.setData({error:error.message||'重试未能开始，请刷新状态。'});notify(error);}}
    finally{if(generation===app._generation)this.setData({submitting:false});}
  },
  async preview(event){
    const item=this.data.samples.concat(this.data.completed||[]).find(item=>item.id===event.currentTarget.dataset.id);if(!item)return;const app=getApp(),generation=app._generation,token=++this._previewToken;
    try{const image=await app.client.download(item.previewUrl);if(this._visible&&generation===app._generation&&token===this._previewToken)this.setData({selected:image});}catch(error){if(generation===app._generation)this.setData({error:error.message});}
  },closePreview(){this._previewToken++;this.setData({selected:null});},
  async approve(){
    const project=this.data.project;if(!project||!project.previewHash||!this.data.quote||this.data.submitting||this.data.projectSessionUnavailable||this.data.projectTemplateChanged||!requireLogin())return;
    const app=getApp(),generation=app._generation,id=project.id;this.setData({submitting:true,error:''});
    try{const response=await app.client.request('/api/sticker-projects/'+id+'/approve',{previewHash:project.previewHash,makeVideo:this.data.makeVideo,bgm:this.data.bgm,pricingHash:this.data.quote.pricingHash});if(generation!==app._generation)return;(app.commit||app.apply).call(app,response.state);if(this._visible&&this.data.project?.id===id){this.showProject(response.project);this.load();}}
    catch(error){if(generation===app._generation){this.setData({error:error.message});notify(error);}}finally{if(generation===app._generation)this.setData({submitting:false});}
  },
  regenerate(){if(this.data.submitting||this.data.busy)return;const project=this.data.project,recipe=project&&project.recipe;this._fingerprint='';this._requestId='';this._previewToken++;this.setData(Object.assign({project:null,projectJob:null,samples:[],selected:null,shareToken:'',completed:[],showTaskRecords:false,newSessionNeeded:this.data.projectSessionUnavailable,error:''},recipe?{mode:recipe.mode,referenceId:recipe.referenceMediaId,referenceName:(this.data.references.find(item=>item.id===recipe.referenceMediaId)||{}).name||'已选角色图',name:recipe.name,style:recipe.style,styleId:recipe.styleId||'custom'}:{}),()=>{if(wx.pageScrollTo)wx.pageScrollTo({scrollTop:0,duration:200});});},
  results(){const project=this.data.project;if(project&&project.ready)wx.navigateTo({url:'/pages/stickers/index?packId='+encodeURIComponent(project.packId)});},
  prepareShare(){return prepareWorkShare(this,getApp(),wx);},
  revokeShare(){return revokeWorkShares(this,getApp(),wx);},
  async progress(){
    if(!requireLogin())return;const app=getApp(),generation=app._generation,sessionId=this.data.project&&this.data.project.sessionId||this._sessionId;
    if(this.data.projectSessionUnavailable){this.setData({showTaskRecords:!this.data.showTaskRecords});this.renderProjectJob();return;}
    try{if(!sessionId)throw Error('项目会话尚未载入，请刷新状态。');if(!app.state||!app.state.sessions.some(session=>session.id===sessionId))await app.refresh();if(!this._visible||generation!==app._generation)return;
      activateSession(app,sessionId,()=>{if(generation===app._generation)wx.showToast({title:'已打开会话，选择状态暂未同步',icon:'none'});});
      wx.switchTab({url:'/pages/chat/index',fail:()=>{if(generation===app._generation)this.setData({error:'打开会话未成功，请再试一次。'});}});
    }catch(error){if(generation===app._generation&&this._visible){this.setData({error:error.message});notify(error);}}
  },
});
