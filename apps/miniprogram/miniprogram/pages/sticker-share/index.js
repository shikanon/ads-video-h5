const {appearanceData}=require('../../utils/appearance');
const {notify}=require('../../utils/page');
const {shareAppMessage}=require('../../utils/share');
Page({
 data:Object.assign(appearanceData(),{loading:true,error:'',share:null,items:[],selected:''}),
 onLoad(query){this._token=/^[a-f0-9]{48}$/.test(query.token||'')?query.token:'';},
 onShow(){this._visible=true;if(getApp().applyAppearance)getApp().applyAppearance(this);this.load();},onHide(){this._visible=false;},
 onShareAppMessage(){if(!this.data.share||!this._token)return shareAppMessage();return {title:this.data.share.name+'｜作品预览',path:'/pages/sticker-share/index?token='+this._token,imageUrl:this.data.items?.[0]?.image||'/assets/lightmao-logo.png'};},
 async load(){this.setData({loading:true,error:''});try{if(!this._token)throw Error('作品链接无效，请向好友获取新的分享。');const app=getApp(),generation=app._generation;let result;try{result=await app.client.request('/api/sticker-shares/'+this._token);}catch(error){if(generation===app._generation||!this._visible)throw error;result=await app.client.request('/api/sticker-shares/'+this._token);}if(!this._visible)return;this.setData({share:result.share,items:result.share.items.map(item=>Object.assign({},item,{image:getApp().client.mediaUrl(item.thumbnailUrl)}))});}catch(error){this.setData({error:error.message,share:null,items:[]});}finally{this.setData({loading:false});}},
 async preview(event){const item=this.data.items.find(i=>i.id===event.currentTarget.dataset.id);if(!item)return;try{const file=await getApp().client.download(item.previewUrl);if(this._visible)this.setData({selected:file});}catch(error){notify(error);}},
 closePreview(){this.setData({selected:''});},
 create(){if(this.data.share)wx.navigateTo({url:'/pages/sticker-studio/index?from=template&mode='+this.data.share.mode+'&styleId='+encodeURIComponent(this.data.share.styleId)});},
});
