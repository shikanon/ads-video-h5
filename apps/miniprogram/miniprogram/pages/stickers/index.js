const { appearanceData } = require('../../utils/appearance');
const { withSession, hide, requireLogin, privacy } = require('../../utils/page');
const { stickerTemplateShare } = require('../../utils/share');
const {prepareWorkShare,loadWorkShares,revokeWorkShares,workShare}=require('../../utils/sticker-work-share');
const { active } = require('../../utils/view');
const { loadThumbnails } = require('../../utils/thumbnails');
const captions = ['今天，电量有点低。', '那就，陪陪我嘛。', '摸摸头，烦恼退退。', '手给你，一起走呀。', '再靠近，一点点。', '好啦，又心动了。'];
Page({
  onShareAppMessage(event){return workShare(event,this)||stickerTemplateShare(event);},
  prepareShare(){return prepareWorkShare(this,getApp(),wx);},revokeShare(){return revokeWorkShares(this,getApp(),wx);},
  data: Object.assign(appearanceData(), { pack: null, items: [], scenes: [], selected: null, title: '被你哄好的一天', makeVideo: true, bgm: true, loading: false, submitting: false, saving: false, busy: false, result: null, error: '', previewError: false }),
  onLoad(query) { this._sessionId = query.sessionId || ''; this._artifactId = query.artifactId || ''; this._packId=query.packId||''; },
  onShow() {
    const app = getApp();
    if (this._formGeneration !== app._generation) {
      if (this._formGeneration !== undefined) { this._sessionId = ''; this._artifactId = ''; this._packId=''; }
      this._formGeneration = app._generation; this._requestFingerprint = ''; this._loadedTaskId = '';
      this.setData({ pack: null, items: [], scenes: [], selected: null, shareToken:'',sharing:false,title: '被你哄好的一天', makeVideo: true, bgm: true, result: null, error: '', loading:false, submitting:false, saving:false });
    }
    withSession(this, this.render); if (app.client.hasSession()) this.load();
  },
  onHide() { this._previewToken=(this._previewToken||0)+1;hide(this); this.setData({ selected: null }); },
  onUnload() { this._previewToken=(this._previewToken||0)+1;hide(this); },
  render(state) {
    if (!state.sessions) return;
    if (!this._sessionId) this._sessionId = state.activeSessionId;
    const artifact = this._artifactId ? state.artifacts.find(item => item.id === this._artifactId && item.kind === 'sticker-pack') : this._packId && state.artifacts.slice().reverse().find(item=>item.kind==='sticker-pack'&&item.sticker&&item.sticker.packId===this._packId);
    this._artifact = artifact || null;
    if(artifact&&artifact.sticker&&artifact.sticker.packId&&this.data.pack&&this.data.pack.id!==artifact.sticker.packId){this._packId=artifact.sticker.packId;this._packGeneration=-1;this.load();}
    this.setData({ busy: state.jobs.some(job => job.sessionId === this._sessionId && active(job)),
      result: artifact ? { name: artifact.name, videoId: artifact.sticker && artifact.sticker.videoId } : null });
    this.restoreTask();
  },
  restoreTask() {
    const task = this._artifact && this._artifact.sticker && this._artifact.sticker.task;
    if (!task || !this.data.items.length || this._loadedTaskId === this._artifact.id) return;
    const scenes = task.sceneIds.map((id, index) => { const choice = this.data.items.findIndex(item => item.id === id); return choice < 0 ? null : { id, choice, name: this.data.items[choice].name, caption: task.captions[index] }; });
    if (scenes.some(scene => !scene)) return;
    this._loadedTaskId = this._artifact.id;
    this.setData({ scenes, title: task.title, makeVideo: true, bgm: task.bgm });
  },
  async load() {
    const app = getApp(), generation = app._generation;
    if (this._packGeneration === generation && this.data.pack || this.data.loading) return;
    this.setData({ loading: true, error: '' });
    try {
      const response = await app.client.request('/api/sticker-packs');
      if (!this._visible || generation !== app._generation) return;
      const wanted=this._packId || this._artifact&&this._artifact.sticker&&this._artifact.sticker.packId;
      let pack = wanted?response.packs.find(pack=>pack.id===wanted):response.packs[0];
      if(wanted&&!pack){const result=await app.client.request('/api/sticker-packs/'+encodeURIComponent(wanted));if(!this._visible||generation!==app._generation)return;pack=result.pack;}
      if (!pack || !pack.items || pack.items.length !== 24) throw new Error('表情套装暂时不可用。');
      const items = pack.items.map(item => Object.assign({}, item, pack.private?{coverSource:item.thumbnailUrl,cover:app.client.cachedDownload&&app.client.cachedDownload(item.thumbnailUrl)||'',thumb:'',preview:item.previewUrl}:{thumb:app.client.templateAssetUrl(item.thumbnailUrl),preview:app.client.templateAssetUrl(item.previewUrl)}));
      this._packGeneration = generation;
      this.setData({ pack: Object.assign({}, pack, { sample: pack.sampleUrl?app.client.templateAssetUrl(pack.sampleUrl):'', poster: pack.private?'':app.client.templateAssetUrl(pack.posterUrl) }), items,
        scenes: pack.defaultSceneIds.map((id, index) => ({ id, choice: items.findIndex(item => item.id === id), name: items.find(item => item.id === id).name, caption: captions[index] })) });
      this.restoreTask();if(pack.private)loadWorkShares(this,app);
      if(pack.private)loadThumbnails(this,'items',app.client);
    } catch (error) { if (this._visible && generation === app._generation) this.setData({ error: error.message }); }
    finally { if(generation===app._generation)this.setData({ loading: false }); }
  },
  async preview(event) { const item=this.data.items.find(item=>item.id===event.currentTarget.dataset.id);if(!item)return;const app=getApp(),generation=app._generation,token=this._previewToken=(this._previewToken||0)+1;
    if(!this.data.pack.private){this.setData({selected:item,previewError:false});return;}
    try{const preview=await app.client.download(item.preview);if(this._visible&&generation===app._generation&&token===this._previewToken)this.setData({selected:Object.assign({},item,{preview}),previewError:false});}catch(error){if(generation===app._generation)this.setData({error:error.message});}
  },
  closePreview() { this._previewToken=(this._previewToken||0)+1;this.setData({ selected: null }); },
  previewError() { this.setData({ previewError: true }); },
  title(event) { this.setData({ title: event.detail.value }); },
  video(event) { this.setData({ makeVideo: event.detail.value }); },
  music(event) { this.setData({ bgm: event.detail.value }); },
  caption(event) { const scenes = this.data.scenes.slice(); const index = Number(event.currentTarget.dataset.index); scenes[index] = Object.assign({}, scenes[index], { caption: event.detail.value }); this.setData({ scenes }); },
  choose(event) { const scenes = this.data.scenes.slice(), index = Number(event.currentTarget.dataset.index), choice = Number(event.detail.value), item = this.data.items[choice]; if (!item || !scenes[index]) return; scenes[index] = Object.assign({}, scenes[index], { id: item.id, choice, name: item.name }); this.setData({ scenes }); },
  async start() {
    if (this.data.submitting || !requireLogin() || !this.data.pack) return;
    const app = getApp();
    if (!app.state || !this._sessionId) { this.setData({ error: '正在同步会话，请稍后重试。' }); return; }
    const generation = app._generation, startingSession = app.state.activeSessionId;
    const task = { packId: this.data.pack.id, title: this.data.title, makeVideo: this.data.makeVideo, bgm: this.data.bgm,
      sceneIds: this.data.scenes.map(scene => scene.id), captions: this.data.scenes.map(scene => scene.caption) };
    if (new Set(task.sceneIds).size !== 6 || !task.title.trim() || task.captions.some(line => !line.trim())) { this.setData({ error: '请选择6个不同动作，并填写片名和每幕短句。' }); return; }
    const fingerprint = JSON.stringify(task);
    if (fingerprint !== this._requestFingerprint) { this._requestFingerprint = fingerprint; this._requestId = 'sticker_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2); }
    this.setData({ submitting: true, error: '' });
    try {
      await app.mutate('/api/sticker-packs/' + encodeURIComponent(task.packId) + '/jobs', { sessionId: this._sessionId, requestId: this._requestId, task });
      if (!this._visible || generation !== app._generation || app.state.activeSessionId !== startingSession) return;
      if (app.state.activeSessionId !== this._sessionId) await app.mutate('/api/sessions/' + encodeURIComponent(this._sessionId) + '/activate', {});
      wx.switchTab({ url: '/pages/chat/index' });
    } catch (error) { if (generation === app._generation) this.setData({ error: error.message }); }
    finally { if(generation===app._generation)this.setData({ submitting: false }); }
  },
  async download() {
    if (!this._artifact || this.data.saving) return;
    const app=getApp(),generation=app._generation,artifact=this._artifact;
    this.setData({ saving: true, error: '' });
    try {
      await privacy();
      if(generation!==app._generation||!this._visible)return;
      const filePath = await app.client.download(artifact.downloadUrl);
      if(generation!==app._generation||!this._visible||this._artifact?.id!==artifact.id)return;
      await new Promise((resolve, reject) => wx.shareFileMessage({ filePath, fileName: artifact.name, success: resolve, fail: reject }));
    } catch (error) { if(generation===app._generation)this.setData({ error: error.message || error.errMsg || '下载或分享未完成，请重试。' }); }
    finally { if(generation===app._generation)this.setData({ saving: false }); }
  },
  videoResult() { if (this.data.result && this.data.result.videoId) wx.navigateTo({ url: '/pages/player/index?type=artifact&id=' + encodeURIComponent(this.data.result.videoId) }); },
});
