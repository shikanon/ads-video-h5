const { appearanceData } = require('../../utils/appearance');
const { withSession, hide, requireLogin, privacy } = require('../../utils/page');
const { shareAppMessage } = require('../../utils/share');
const { active } = require('../../utils/view');
const captions = ['今天，电量有点低。', '那就，陪陪我嘛。', '摸摸头，烦恼退退。', '手给你，一起走呀。', '再靠近，一点点。', '好啦，又心动了。'];
Page({
  onShareAppMessage: shareAppMessage,
  data: Object.assign(appearanceData(), { pack: null, items: [], scenes: [], selected: null, title: '被你哄好的一天', makeVideo: true, bgm: true, loading: false, submitting: false, saving: false, busy: false, result: null, error: '', previewError: false }),
  onLoad(query) { this._sessionId = query.sessionId || ''; this._artifactId = query.artifactId || ''; },
  onShow() {
    const app = getApp();
    if (this._formGeneration !== app._generation) {
      if (this._formGeneration !== undefined) { this._sessionId = ''; this._artifactId = ''; }
      this._formGeneration = app._generation; this._requestFingerprint = ''; this._loadedTaskId = '';
      this.setData({ pack: null, items: [], scenes: [], selected: null, title: '被你哄好的一天', makeVideo: true, bgm: true, result: null, error: '' });
    }
    withSession(this, this.render); if (app.client.hasSession()) this.load();
  },
  onHide() { hide(this); this.setData({ selected: null }); },
  onUnload() { hide(this); },
  render(state) {
    if (!state.sessions) return;
    if (!this._sessionId) this._sessionId = state.activeSessionId;
    const artifact = this._artifactId && state.artifacts.find(item => item.id === this._artifactId && item.kind === 'sticker-pack');
    this._artifact = artifact || null;
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
      const pack = response.packs[0];
      if (!pack || !pack.items || pack.items.length !== 24) throw new Error('表情套装暂时不可用。');
      const items = pack.items.map(item => Object.assign({}, item, { thumb: app.client.templateAssetUrl(item.thumbnailUrl), preview: app.client.templateAssetUrl(item.previewUrl) }));
      this._packGeneration = generation;
      this.setData({ pack: Object.assign({}, pack, { sample: app.client.templateAssetUrl(pack.sampleUrl), poster: app.client.templateAssetUrl(pack.posterUrl) }), items,
        scenes: pack.defaultSceneIds.map((id, index) => ({ id, choice: items.findIndex(item => item.id === id), name: items.find(item => item.id === id).name, caption: captions[index] })) });
      this.restoreTask();
    } catch (error) { if (this._visible && generation === app._generation) this.setData({ error: error.message }); }
    finally { this.setData({ loading: false }); }
  },
  preview(event) { this.setData({ selected: this.data.items.find(item => item.id === event.currentTarget.dataset.id), previewError: false }); },
  closePreview() { this.setData({ selected: null }); },
  previewError() { this.setData({ previewError: true }); },
  title(event) { this.setData({ title: event.detail.value }); },
  video(event) { this.setData({ makeVideo: event.detail.value }); },
  music(event) { this.setData({ bgm: event.detail.value }); },
  caption(event) { const scenes = this.data.scenes.slice(); const index = Number(event.currentTarget.dataset.index); scenes[index] = Object.assign({}, scenes[index], { caption: event.detail.value }); this.setData({ scenes }); },
  choose(event) { const scenes = this.data.scenes.slice(), index = Number(event.currentTarget.dataset.index), choice = Number(event.detail.value), item = this.data.items[choice]; if (!item || !scenes[index]) return; scenes[index] = Object.assign({}, scenes[index], { id: item.id, choice, name: item.name }); this.setData({ scenes }); },
  async start() {
    if (this.data.submitting || !requireLogin() || !this.data.pack) return;
    const app = getApp(), generation = app._generation, startingSession = app.state.activeSessionId;
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
    finally { this.setData({ submitting: false }); }
  },
  async download() {
    if (!this._artifact || this.data.saving) return;
    this.setData({ saving: true, error: '' });
    try {
      await privacy();
      const filePath = await getApp().client.download(this._artifact.downloadUrl);
      await new Promise((resolve, reject) => wx.shareFileMessage({ filePath, fileName: this._artifact.name, success: resolve, fail: reject }));
    } catch (error) { this.setData({ error: error.message || error.errMsg || '下载或分享未完成，请重试。' }); }
    finally { this.setData({ saving: false }); }
  },
  videoResult() { if (this.data.result && this.data.result.videoId) wx.navigateTo({ url: '/pages/player/index?type=artifact&id=' + encodeURIComponent(this.data.result.videoId) }); },
});
