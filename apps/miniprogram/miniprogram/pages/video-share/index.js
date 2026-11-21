const {appearanceData}=require('../../utils/appearance');
const {shareAppMessage}=require('../../utils/share');
const {notify,requireLogin}=require('../../utils/page');
Page({
 data:Object.assign(appearanceData(),{share:null,error:'',loading:true}),
 onLoad(q){this._token=/^[a-f0-9]{48}$/.test(q.token||'')?q.token:'';},
 onShow(){this._visible=true;const app=getApp();if(app.applyAppearance)app.applyAppearance(this);this.load();},onHide(){this._visible=false;},
 async load(){this.setData({loading:true,error:''});try{if(!this._token)throw Error('作品链接无效。');const app=getApp(),g=app._generation;let r;try{r=await app.client.request('/api/video-shares/'+this._token);}catch(e){if(g===app._generation||!this._visible)throw e;r=await app.client.request('/api/video-shares/'+this._token);}if(this._visible)this.setData({share:r.share,src:app.client.mediaUrl(r.share.videoUrl),cover:app.client.mediaUrl(r.share.coverUrl)});}catch(e){this.setData({error:e.message,share:null});}finally{this.setData({loading:false});}},
 onShareAppMessage(){if(!this.data.share||!this._token)return shareAppMessage();return {title:this.data.share?.name||'视频作品',path:'/pages/video-share/index?token='+this._token,imageUrl:this.data.cover||'/assets/lightmao-logo.png'};},
 mediaError(){this.setData({error:'视频暂不可用，请重新打开或向好友获取新链接。'});},
 async create(){if(!requireLogin()||!this.data.share)return;try{await getApp().client.request('/api/work-shares/use',{kind:'video',token:this._token});getApp().pendingVideoTemplate=true;wx.switchTab({url:'/pages/templates/index'});}catch(e){notify(e);}}
});
