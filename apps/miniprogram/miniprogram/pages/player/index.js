const { appearanceData } = require('../../utils/appearance');
const { shareAppMessage } = require("../../utils/share");
const { notify, withSession, hide, privacy } = require('../../utils/page');
const { beijingTime } = require('../../utils/view');
const { brandText } = require('../../utils/brand');
const {prepareVideoShare,closeVideoShare,videoShare}=require('../../utils/video-work-share');
Page({
  onShareAppMessage(e){return videoShare(this,e)||shareAppMessage();},
  prepareShare(){return prepareVideoShare(this);},closeShare(){return closeVideoShare(this);},
  data: Object.assign(appearanceData(), { item: null, isMedia: false, src: '', loading: false, saving: false, error: '', playing: false, elapsed: 0, duration: 0, analysis: '', analyzing: false }),
  onLoad(query) { this._id = query.id; this._type = query.type === 'artifact' ? 'artifact' : 'media'; this.setData({ isMedia: this._type === 'media' }); },
  onShow() { const g=getApp()._generation;if(this._shareGeneration!==g){this._shareGeneration=g;this.setData({shareToken:'',shareCover:'',src:''});}withSession(this, this.render); },
  onHide() { hide(this); if (this._audio) this._audio.pause(); },
  onUnload() { hide(this); if (this._audio) this._audio.destroy(); },
  render(state) {
    const all = this._type === 'artifact' ? state.artifacts : state.media;
    const item = all.find(value => value.id === this._id);
    if (!item) { this.setData({ error: '文件不存在，可能已被删除。', item: null }); return; }
    if (item.kind === 'sticker-pack') {
      if (!this._redirected) { this._redirected = true; wx.redirectTo({ url: '/pages/stickers/index?artifactId=' + encodeURIComponent(item.id) + '&sessionId=' + encodeURIComponent(item.sessionId) }); }
      return;
    }
    this._item = item;
    this.setData({documentText:item.document?.text||'',documentTruncated:Boolean(item.document?.truncated),isWord:/\.docx$/i.test(item.name)});
    this.setData({ item: { id: item.id, name: this._type === 'artifact' ? brandText(item.name) : item.name, kind: item.kind, project: Boolean(item.projectUrl), largeVideo:item.kind==='video'&&item.sizeBytes>200*1024*1024, date: beijingTime(item.createdAt), duration: item.duration ? Math.round(item.duration) + ' 秒' : '' }, analysis: item.analysis && item.analysis.transcript || '' });
    if (item.kind!=='document' && !this.data.src && !this.data.loading) this.load();
  },
  async load() {
    if (!this._item || this.data.loading) return;
    this.setData({ loading: true, error: '' });
    try {
      const app=getApp(),generation=app._generation,client = app.client;
      let src = client.previewUrl(this._item.url);
      if(!src&&this._item.kind==='video'&&typeof client.request==='function'){
        const playback=await client.request('/api/media-playback',{type:this._type,id:this._id});
        if(generation!==app._generation)return;
        if(!playback||typeof playback.url!=='string')throw Error('视频播放地址暂不可用，请重试。');
        src=client.mediaUrl(playback.url);
      }
      if(!src)src=await client.download(this._item.url);
      if (!this._visible) return;
      this.setData({ src });
      if (this._item.kind === 'audio') {
        if (this._audio) this._audio.destroy();
        const audio = this._audio = wx.createInnerAudioContext(); audio.src = src;
        audio.onPlay(() => this.setData({ playing: true })); audio.onPause(() => this.setData({ playing: false })); audio.onEnded(() => this.setData({ playing: false }));
        audio.onTimeUpdate(() => this.setData({ elapsed: Math.floor(audio.currentTime), duration: Math.floor(audio.duration) }));
        audio.onError(() => this.setData({ error: '音频暂时无法播放，请重试。', playing: false }));
      }
    } catch (error) { this.setData({ error: error.message }); } finally { this.setData({ loading: false }); }
  },
  async openDocument(){if(!this._item||this._item.kind!=='document')return;try{const filePath=await getApp().client.download(this._item.url);if(this._visible)wx.openDocument({filePath,fileType:'docx',showMenu:true});}catch(error){notify(error);}},
  copyDocument(){if(this.data.documentText)wx.setClipboardData({data:this.data.documentText});},
  mediaError() { this.setData({ error: '文件暂时无法播放，请重新加载。' }); },
  retry() { this.setData({ src: '' }); this.load(); },
  toggleAudio() { if (this._audio) this.data.playing ? this._audio.pause() : this._audio.play(); },
  async image() { if (!this.data.src) return; try { await privacy(); wx.previewImage({ urls: [this.data.src], current: this.data.src }); } catch (error) { notify(error); } },
  async save() {
    if (this.data.saving || !this._item || this._item.kind==='document') return;
    if(this._item.kind==='video'&&this._item.sizeBytes>200*1024*1024)return this.copyVideoLink();
    this.setData({ saving: true, error: '' });
    try {
      await privacy();
      const path = await getApp().client.download(this._item.downloadUrl || this._item.url);
      const method = this._item.kind === 'video' ? 'saveVideoToPhotosAlbum' : 'saveImageToPhotosAlbum';
      await new Promise((resolve, reject) => wx[method]({ filePath: path, success: resolve, fail: error => reject(new Error(/auth|deny/.test(error.errMsg || '') ? '请在微信设置中允许保存到相册后重试。' : '保存失败，请检查相册权限和手机空间。')) }));
      wx.showToast({ title: '已保存到相册', icon: 'success' });
    } catch (error) { this.setData({ error: error.message }); } finally { this.setData({ saving: false }); }
  },
  async copyVideoLink(){if(this.data.saving||!this._item)return;const app=getApp(),g=app._generation;const ok=await new Promise(resolve=>wx.showModal({title:'下载高清原片',content:'高清原片超过微信直接保存的大小。复制下载链接，在浏览器中保存；链接30分钟有效。',confirmText:'复制链接',success:r=>resolve(r.confirm),fail:()=>resolve(false)}));if(!ok||g!==app._generation)return;this.setData({saving:true,error:''});try{const r=await app.client.request('/api/media-playback',{type:this._type,id:this._id,download:true});if(g!==app._generation)return;const data=app.client.mediaUrl(r.url);if(!data)throw Error('下载链接暂不可用。');await new Promise((resolve,reject)=>wx.setClipboardData({data,success:resolve,fail:reject}));}catch(e){if(g===app._generation)this.setData({error:e.message||'复制未完成，请重试。'});}finally{if(g===app._generation)this.setData({saving:false});}},
  use() { if (this._type === 'media') { getApp().pendingAttachments = [this._id]; wx.switchTab({ url: '/pages/chat/index' }); } },
  async manage(){if(!this._item)return;const item=this._item,choice=await new Promise(resolve=>wx.showActionSheet({itemList:['重命名',this._type==='media'?'删除素材':'删除作品'],success:r=>resolve(r.tapIndex),fail:()=>resolve(-1)})),manage=require('../../utils/manage');if(choice===0)return manage.rename(this,'/api/'+(this._type==='media'?'media':'artifacts')+'/'+encodeURIComponent(item.id),'name',item.name);if(choice===1){const removed=await(this._type==='media'?manage.deleteMedia(this,item.id):manage.deleteArtifact(this,item.id));if(removed&&this._visible)wx.navigateBack();}},
  async project() {
    if (!this._item || !this._item.projectUrl || this.data.saving) return;
    this.setData({ saving: true, error: '' });
    try {
      await privacy();
      const filePath = await getApp().client.download(this._item.projectUrl);
      await new Promise((resolve, reject) => wx.shareFileMessage({ filePath, fileName: this._item.name.replace(/\.mp4$/, '') + '-工程与封面.zip', success: resolve, fail: reject }));
    } catch (error) { this.setData({ error: error.message || error.errMsg || '工程下载未完成，请重试。' }); }
    finally { this.setData({ saving: false }); }
  },
  async analyze() {
    if (this.data.analyzing || !['audio','video'].includes(this._item?.kind)) return; this.setData({ analyzing: true });
    try { await getApp().mutate('/api/media/' + encodeURIComponent(this._id) + '/analyze', { sessionId: getApp().state.activeSessionId }); wx.switchTab({ url: '/pages/chat/index' }); } catch (error) { notify(error); } finally { this.setData({ analyzing: false }); }
  },
});
