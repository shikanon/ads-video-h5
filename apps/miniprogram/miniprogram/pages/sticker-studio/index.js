const { appearanceData } = require('../../utils/appearance');
const { withSession, hide, requireLogin, privacy } = require('../../utils/page');
const { uploadMedia } = require('../../utils/upload');
const { mediaView, active } = require('../../utils/view');
const { loadThumbnails, coverError } = require('../../utils/thumbnails');
const { shareAppMessage } = require('../../utils/share');
Page({
  onShareAppMessage: shareAppMessage,
  data: Object.assign(appearanceData(), { mode:'dynamic', name:'', style:'柔彩Q版，保留角色原有发型、服装和配饰', references:[], referenceId:'', referenceName:'', available:false, checking:true, loading:false, submitting:false, uploading:false, makeVideo:true, bgm:true, projects:[], project:null, samples:[], selected:null, error:'' }),
  onLoad(query) { this.setData({mode:query.mode==='static'?'static':'dynamic'});this._sessionId=query.sessionId||'';this._previewToken=0;this._loadToken=0; },
  onShow() {
    const app=getApp();
    if(this._generation!==app._generation){if(this._generation!==undefined)this._sessionId='';this._generation=app._generation;this._requestId='';this._fingerprint='';this._pollKey='';this._previewToken=(this._previewToken||0)+1;this.setData({referenceId:'',referenceName:'',name:'',style:'柔彩Q版，保留角色原有发型、服装和配饰',references:[],projects:[],project:null,samples:[],selected:null,error:'',submitting:false,uploading:false,available:false,checking:true});}
    if(withSession(this,this.render))this.load();
  },
  onHide(){hide(this);this._previewToken++;this.setData({selected:null});},onUnload(){hide(this);this._previewToken++;},
  onPullDownRefresh(){return this.load().finally(()=>wx.stopPullDownRefresh());},
  render(state){
    const app=getApp();if(!this._sessionId)this._sessionId=state.activeSessionId;
    this.setData({references:(state.media||[]).filter(item=>item.kind==='image'&&['image/png','image/jpeg','image/webp'].includes(item.mimeType)).slice(-30).reverse().map(item=>mediaView(item,app.client))});loadThumbnails(this,'references',app.client);
    const jobs=(state.jobs||[]).filter(job=>job.stickerGenerationTask),busy=jobs.some(job=>active(job)&&job.sessionId===this._sessionId),key=jobs.map(job=>job.id+':'+job.status).join('|');
    this.setData({busy});if(this._visible&&key!==this._pollKey){this._pollKey=key;this.load();}
    this.renderProjectJob();
  },
  async load(){
    if(!getApp().client.hasSession())return;
    const app=getApp(),generation=app._generation,token=this._loadToken=(this._loadToken||0)+1;this.setData({loading:true,error:''});
    try{
      const [config,response]=await Promise.all([app.client.request('/api/sticker-projects/config'),app.client.request('/api/sticker-projects')]);
      if(!this._visible||generation!==app._generation||token!==this._loadToken)return;
      const projects=response.projects.slice().sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
      this.setData({available:config.available,checking:false,projects});
      const selected=this.data.project&&projects.find(item=>item.id===this.data.project.id);if(selected)this.showProject(selected);
    }catch(error){if(this._visible&&generation===app._generation&&token===this._loadToken)this.setData({checking:false,error:error.message||'表情工坊需要更新后端后使用。'});}
    finally{if(generation===app._generation&&token===this._loadToken)this.setData({loading:false});}
  },
  coverError(event){coverError(this,'references',event,getApp().client);},
  mode(event){if(!this.data.submitting)this.setData({mode:event.currentTarget.dataset.mode,project:null,samples:[]});},
  name(event){this.setData({name:event.detail.value});},changeStyle(event){this.setData({style:event.detail.value});},
  reference(event){const item=this.data.references.find(item=>item.id===event.currentTarget.dataset.id);if(item)this.setData({referenceId:item.id,referenceName:item.name});},
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
    if(this.data.submitting||!requireLogin()||!this.data.available)return;
    const app=getApp(),generation=app._generation,sessionId=this._sessionId;
    if(!app.state||!sessionId){this.setData({error:'正在同步会话，请稍后重试。'});return;}
    const recipe={referenceMediaId:this.data.referenceId,name:this.data.name.trim(),style:this.data.style.trim(),mode:this.data.mode};
    if(!recipe.referenceMediaId||!recipe.name||!recipe.style){this.setData({error:'请选择角色图，填写套装名称与画风。'});return;}
    const fingerprint=JSON.stringify({sessionId,recipe});if(fingerprint!==this._fingerprint){this._fingerprint=fingerprint;this._requestId='sticker_studio_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2);}
    this.setData({submitting:true,error:''});
    try{const response=await app.client.request('/api/sticker-projects',{sessionId,requestId:this._requestId,recipe});
      if(generation!==app._generation)return;app.apply(response.state);if(!this._visible)return;this.showProject(response.project);this.load();
    }catch(error){if(generation===app._generation)this.setData({error:error.message});}
    finally{if(generation===app._generation)this.setData({submitting:false});}
  },
  openProject(event){const project=this.data.projects.find(item=>item.id===event.currentTarget.dataset.id);if(project)this.showProject(project);},
  showProject(project){
    const app=getApp(),generation=app._generation,token=++this._previewToken;this.setData({project,samples:project.samples.map(item=>Object.assign({},item,{image:''}))});
    this.renderProjectJob();
    Promise.all(project.samples.map(async item=>{try{const image=await app.client.download(item.thumbnailUrl,{persistent:true});if(!this._visible||generation!==app._generation||token!==this._previewToken)return;this.setData({samples:this.data.samples.map(sample=>sample.id===item.id?Object.assign({},sample,{image}):sample)});}catch{ /* individual preview remains retryable */ }}));
  },
  renderProjectJob(){const project=this.data.project,jobs=getApp().state&&getApp().state.jobs||[],job=project&&jobs.slice().reverse().find(job=>job.stickerGenerationTask&&job.stickerGenerationTask.projectId===project.id);this.setData({projectJob:job?{status:({queued:'排队中',running:'制作中',failed:'未完成，可在会话中重试',cancelled:'已停止',succeeded:'此阶段已完成'})[job.status]||job.status,stage:job.stage||'',error:job.error||''}:null});},
  async preview(event){
    const item=this.data.samples.find(item=>item.id===event.currentTarget.dataset.id);if(!item)return;const app=getApp(),generation=app._generation,token=++this._previewToken;
    try{const image=await app.client.download(item.previewUrl);if(this._visible&&generation===app._generation&&token===this._previewToken)this.setData({selected:image});}catch(error){if(generation===app._generation)this.setData({error:error.message});}
  },closePreview(){this._previewToken++;this.setData({selected:null});},
  async approve(){
    const project=this.data.project;if(!project||!project.previewHash||this.data.submitting||!requireLogin())return;
    const app=getApp(),generation=app._generation,id=project.id;this.setData({submitting:true,error:''});
    try{const response=await app.client.request('/api/sticker-projects/'+id+'/approve',{previewHash:project.previewHash,makeVideo:this.data.makeVideo,bgm:this.data.bgm});if(generation!==app._generation)return;app.apply(response.state);if(this._visible&&this.data.project?.id===id){this.showProject(response.project);this.load();}}
    catch(error){if(generation===app._generation)this.setData({error:error.message});}finally{if(generation===app._generation)this.setData({submitting:false});}
  },
  regenerate(){if(this.data.submitting)return;this._fingerprint='';this._requestId='';this.setData({project:null,samples:[],selected:null,error:''});},
  results(){const project=this.data.project;if(project&&project.ready)wx.navigateTo({url:'/pages/stickers/index?packId='+encodeURIComponent(project.packId)});},
  async progress(){const app=getApp(),generation=app._generation,sessionId=this.data.project&&this.data.project.sessionId||this._sessionId,starting=app.state&&app.state.activeSessionId;try{if(sessionId&&sessionId!==starting)await app.mutate('/api/sessions/'+encodeURIComponent(sessionId)+'/activate',{});if(this._visible&&generation===app._generation&&app.state&&app.state.activeSessionId===sessionId)wx.switchTab({url:'/pages/chat/index'});}catch(error){if(generation===app._generation)this.setData({error:error.message});}},
});
