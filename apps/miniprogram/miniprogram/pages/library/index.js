const { appearanceData } = require('../../utils/appearance');
const { shareAppMessage, shareTimeline } = require("../../utils/share");
const { mediaView, artifactView, jobView, active } = require('../../utils/view');
const { notify, withSession, hide, requireLogin, guestState } = require('../../utils/page');
const { chooseFiles, uploadMedia, livePhotoHelp } = require('../../utils/upload');
const { loadThumbnails, coverError } = require('../../utils/thumbnails');
const { collectionOf, isProduction } = require('../../utils/media-collections');
Page({
  onShareAppMessage: shareAppMessage,
  onShareTimeline: shareTimeline,
  data: Object.assign(appearanceData(), { section: 'materials', jobs: [], materialCount: 0, filmCount: 0, items: [], collection: 'library', query: '', filter: 'all', more: false, uploading: false, uploadText: '', count: 0 }),
  onLoad() { this._limit = 30; this._sectionViews = {}; },
  onShow() {
    const app = getApp();
    if (app.pendingResourceSection) { this.changeSection(app.pendingResourceSection, false); app.pendingResourceSection = null; }
    if (app.pendingLibraryCollection) { this.changeSection('materials', false); this.setData({ collection: app.pendingLibraryCollection }); this._limit = 30; app.pendingLibraryCollection = null; }
    withSession(this, this.render);
  },
  onHide() { hide(this); }, onUnload() { hide(this); },
  render(state) {
    const films = this.data.section === 'films';
    const source = films ? state.artifacts : state.media.filter(item => !item.character && (this.data.collection === 'clips' ? Boolean(item.archive) && collectionOf(item) === 'library' : collectionOf(item) === this.data.collection));
    const kindFilters = [{ id: 'all', name: '全部' }, { id: 'video', name: '视频' }, { id: 'image', name: '图片' }, { id: 'audio', name: '音频' }].concat(films ? [{ id: 'sticker-pack', name: '表情包' }, { id: 'game', name: '游戏' }] : []);
    const kindCounts = { all: source.length }; for (const item of source) kindCounts[item.kind] = (kindCounts[item.kind] || 0) + 1;
    this.setData({ kindFilters, kindCounts });
    this.setData({ materialCount: state.media.filter(item => !item.character && collectionOf(item) === 'library').length, filmCount: state.artifacts.length });
    if (films) {
      const needle = this.data.query.trim().toLowerCase();
      const all = state.artifacts.filter(item => (this.data.filter === 'all' || item.kind === this.data.filter) && item.name.toLowerCase().includes(needle)).slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      this.setData({ items: all.slice(0, this._limit).map(item => artifactView(item, getApp().client)), jobs: state.jobs.filter(active).slice(0, 10).map(job => jobView(job)), more: all.length > this._limit, count: all.length });
      loadThumbnails(this, 'items', getApp().client);
      return;
    }
    const needle = this.data.query.trim().toLowerCase(), all = state.media.filter(item => !item.character && (this.data.collection === 'clips' ? Boolean(item.archive) && collectionOf(item) === 'library' : collectionOf(item) === this.data.collection) && (this.data.filter === 'all' || item.kind === this.data.filter) && (item.name + ' ' + (item.archive && item.archive.tags || []).join(' ')).toLowerCase().includes(needle)).slice().reverse();
    this.setData({ items: all.slice(0, this._limit).map(item => Object.assign(mediaView(item, getApp().client), { production: collectionOf(item) === 'production', productionSource: isProduction(item), archivedClip: Boolean(item.archive), tags: item.archive && item.archive.tags || [] })), jobs: [], more: all.length > this._limit, count: all.length, productionCount: state.media.filter(m => !m.character && collectionOf(m) === 'production').length });
    loadThumbnails(this, 'items', getApp().client);
  },
  section(event) { this.changeSection(event.currentTarget.dataset.section, true); },
  changeSection(section, render) {
    if (!['materials', 'films'].includes(section) || section === this.data.section) return;
    const views = this._sectionViews || (this._sectionViews = {});
    views[this.data.section] = { query: this.data.query, filter: this.data.filter, limit: this._limit || 30 };
    const next = views[section] || { query: '', filter: 'all', limit: 30 };
    this._limit = next.limit;
    this.setData({ section, query: next.query, filter: next.filter, items: [], jobs: [] });
    if (render) { this.render(getApp().state || guestState()); if (wx.pageScrollTo) wx.pageScrollTo({ scrollTop: 0, duration: 0 }); }
  },
  filter(event) { this._limit = 30; this.setData({ filter: event.currentTarget.dataset.kind }); this.render(getApp().state || guestState()); },
  collection(event) { this._limit = 30; this.setData({ collection: event.currentTarget.dataset.collection }); this.render(getApp().state || guestState()); },
  search(event) { this._limit = 30; this.setData({ query: event.detail.value }); this.render(getApp().state || guestState()); },
  film(event) { wx.navigateTo({ url: '/pages/film/index' + (event.currentTarget.dataset.id ? '?id=' + encodeURIComponent(event.currentTarget.dataset.id) : '') }); },
  async itemMenu(event) {
    const item = this.data.items.find(item => item.id === event.currentTarget.dataset.id); if (!item) return;
    const app = getApp(), generation = app._generation, section = this.data.section;
    const options = [{ name: '预览', run: () => this.play(event) }];
    if (section === 'materials') {
      if (!item.production) options.push({ name: '用来创作', run: () => this.use(event) });
      if (item.kind === 'video' && !item.production) options.push({ name: '拉片分析', run: () => this.film(event) });
      if (item.production || item.productionSource) options.push({ name: item.production ? '恢复到可用素材' : '移到制作归档', run: () => this.moveCollection({ currentTarget: { dataset: { id: item.id, collection: item.production ? 'library' : 'production' } } }) });
      options.push({ name: '删除素材', run: () => this.remove(event) });
    }
    const index = await new Promise(resolve => wx.showActionSheet({ itemList: options.map(option => option.name), success: result => resolve(result.tapIndex), fail: () => resolve(-1) }));
    if (!this._visible || app._generation !== generation || this.data.section !== section || !this.data.items.some(current => current.id === item.id)) return;
    if (options[index]) return options[index].run();
  },
  async moveCollection(event) { if (!requireLogin()) return; if (!getApp().state.features || !getApp().state.features.filmAnalysis) { notify(new Error('当前服务暂不支持保存素材归档位置。')); return; } try { await getApp().mutate('/api/media/' + encodeURIComponent(event.currentTarget.dataset.id) + '/collection', { collection: event.currentTarget.dataset.collection }, 'PATCH'); wx.showToast({ title: '已更新归档位置', icon: 'none' }); } catch (error) { notify(error); } },
  more() { this._limit += 30; this.render(getApp().state || guestState()); },
  play(event) { wx.navigateTo({ url: '/pages/player/index?type=' + (this.data.section === 'films' ? 'artifact' : 'media') + '&id=' + encodeURIComponent(event.currentTarget.dataset.id) }); },
  create() { wx.switchTab({ url: '/pages/chat/index' }); },
  async session(event) {
    const app = getApp(), job = app.state && app.state.jobs.find(item => item.id === event.currentTarget.dataset.id);
    if (!job) return;
    try { await app.mutate('/api/sessions/' + encodeURIComponent(job.sessionId) + '/activate', {}); wx.switchTab({ url: '/pages/chat/index' }); } catch (error) { notify(error); }
  },
  coverError(event) { coverError(this, 'items', event, getApp().client); },
  retryCover() { loadThumbnails(this, 'items', getApp().client); },
  livePhotoHelp,
  use(event) { getApp().pendingAttachments = [event.currentTarget.dataset.id]; wx.switchTab({ url: '/pages/chat/index' }); },
  async upload() {
    if (this.data.uploading) return;
    if (!requireLogin()) return;
    this.setData({ uploading: true });
    try {
      const audio = await new Promise(resolve => wx.showActionSheet({ itemList: ['相册 / 拍摄（图视频混选）', '聊天文件 / 音频'], success: result => resolve(result.tapIndex === 1), fail: () => resolve(null) }));
      if (audio === null) return;
      const files = await chooseFiles(audio); if (!files.length) return;
      await uploadMedia(getApp(), files, (at, total, percent) => this.setData({ uploadText: '上传 ' + at + '/' + total + ' · ' + percent + '%' }));
      wx.showToast({ title: '已添加 ' + files.length + ' 个素材', icon: 'success' });
    } catch (error) { notify(error); }
    finally { this.setData({ uploading: false, uploadText: '' }); }
  },
  async remove(event) {
    if (!requireLogin()) return;
    const id = event.currentTarget.dataset.id;
    const confirm = await new Promise(resolve => wx.showModal({ title: '删除素材？', content: '此操作会从账号素材库删除该文件，请确认无需继续使用。', confirmText: '删除', confirmColor: '#b55841', success: result => resolve(result.confirm), fail: () => resolve(false) }));
    if (!confirm) return;
    try { await getApp().mutate('/api/media/' + encodeURIComponent(id), undefined, 'DELETE'); } catch (error) { notify(error); }
  },
});
