const { appearanceData } = require('../../utils/appearance');
const { shareAppMessage } = require("../../utils/share");
const { notify, withSession, hide, privacy } = require('../../utils/page');
const { beijingTime } = require('../../utils/view');
const { brandText } = require('../../utils/brand');
Page({
  onShareAppMessage: shareAppMessage,
  data: Object.assign(appearanceData(), { item: null, isMedia: false, src: '', loading: false, saving: false, error: '', playing: false, elapsed: 0, duration: 0, analysis: '', analyzing: false }),
  onLoad(query) { this._id = query.id; this._type = query.type === 'artifact' ? 'artifact' : 'media'; this.setData({ isMedia: this._type === 'media' }); },
  onShow() { withSession(this, this.render); },
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
    this.setData({ item: { id: item.id, name: this._type === 'artifact' ? brandText(item.name) : item.name, kind: item.kind, project: Boolean(item.projectUrl), date: beijingTime(item.createdAt), duration: item.duration ? Math.round(item.duration) + ' 秒' : '' }, analysis: item.analysis && item.analysis.transcript || '' });
    if (!this.data.src && !this.data.loading) this.load();
  },
  async load() {
    if (!this._item || this.data.loading) return;
    this.setData({ loading: true, error: '' });
    try {
      const client = getApp().client;
      const src = client.previewUrl(this._item.url) || await client.download(this._item.url);
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
  mediaError() { this.setData({ error: '文件暂时无法播放，请重新加载。' }); },
  retry() { this.setData({ src: '' }); this.load(); },
  toggleAudio() { if (this._audio) this.data.playing ? this._audio.pause() : this._audio.play(); },
  async image() { if (!this.data.src) return; try { await privacy(); wx.previewImage({ urls: [this.data.src], current: this.data.src }); } catch (error) { notify(error); } },
  async save() {
    if (this.data.saving || !this._item) return;
    this.setData({ saving: true, error: '' });
    try {
      await privacy();
      const path = await getApp().client.download(this._item.downloadUrl || this._item.url);
      const method = this._item.kind === 'video' ? 'saveVideoToPhotosAlbum' : 'saveImageToPhotosAlbum';
      await new Promise((resolve, reject) => wx[method]({ filePath: path, success: resolve, fail: error => reject(new Error(/auth|deny/.test(error.errMsg || '') ? '请在微信设置中允许保存到相册后重试。' : '保存失败，请检查相册权限和手机空间。')) }));
      wx.showToast({ title: '已保存到相册', icon: 'success' });
    } catch (error) { this.setData({ error: error.message }); } finally { this.setData({ saving: false }); }
  },
  use() { if (this._type === 'media') { getApp().pendingAttachments = [this._id]; wx.switchTab({ url: '/pages/chat/index' }); } },
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
    if (this.data.analyzing) return; this.setData({ analyzing: true });
    try { await getApp().mutate('/api/media/' + encodeURIComponent(this._id) + '/analyze', { sessionId: getApp().state.activeSessionId }); wx.switchTab({ url: '/pages/chat/index' }); } catch (error) { notify(error); } finally { this.setData({ analyzing: false }); }
  },
});
