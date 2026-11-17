const { shareAppMessage, shareTimeline } = require('../../utils/share');
const { appearanceData } = require('../../utils/appearance');
const { requireLogin } = require('../../utils/page');
const { galleryCards, galleryCategories } = require('../../utils/templates');

Page({
  onShareAppMessage: shareAppMessage,
  onShareTimeline: shareTimeline,
  data: Object.assign(appearanceData(), { cards: [], categories: [], query: '', category: 'all', preview: null, loading: false, error: '', returning: false, guest: true }),
  onShow() {
    const app = getApp();
    this._visible = true;
    this._origin = app.templateOrigin;
    app.templateOrigin = null;
    if (app.applyAppearance) app.applyAppearance(this);
    if (wx.showShareMenu) wx.showShareMenu({ menus: ['shareAppMessage', 'shareTimeline'] });
    this.setData({ guest: !app.client.hasSession(), returning: false });
    if (this.data.guest) { this._catalog = null; this.setData({ cards: [], categories: [], preview: null, error: '' }); return; }
    if (this._catalogGeneration !== app._generation) { this._catalog = null; this.setData({ cards: [], categories: [], preview: null }); }
    if (this._catalog) this.filter();
    this.load();
  },
  onHide() { this._visible = false; this._origin = null; this.setData({ preview: null }); },
  onUnload() { this._visible = false; },
  onPullDownRefresh() { return this.load().finally(() => wx.stopPullDownRefresh()); },
  login() { requireLogin(); },
  async load() {
    const app = getApp();
    if (!app.client.hasSession()) return;
    if (this._loading && this._loading.generation === app._generation) return this._loading.promise;
    const request = { generation: app._generation };
    this._loading = request;
    this.setData({ loading: true, error: '' });
    request.promise = (async () => {
      try {
        const response = await app.client.request('/api/templates?surface=tools');
        if (request.generation !== app._generation) return;
        this._catalog = galleryCards(response.templates, app.client);
        if (app.state) app.state.templates = response.templates;
        this._catalogGeneration = request.generation;
        if (this._visible) this.filter();
      } catch (error) {
        if (this._visible && request.generation === app._generation) this.setData({ error: error.message || '模板暂时无法加载。' });
      } finally {
        if (this._loading === request) { this._loading = null; this.setData({ loading: false }); }
      }
    })();
    return request.promise;
  },
  filter(query = this.data.query, category = this.data.category) {
    const search = query.trim().toLowerCase();
    const cards = (this._catalog || []).filter(card =>
      (category === 'all' || card.category === category || category === 'skills' && card.skill) &&
      (card.name + ' ' + card.description + ' ' + card.id).toLowerCase().includes(search));
    this.setData({ cards, query, category, categories: galleryCategories(this._catalog || []) });
  },
  input(event) { this.filter(event.detail.value); },
  chooseFilter(event) { this.filter(this.data.query, event.currentTarget.dataset.category); },
  preview(event) {
    const card = (this._catalog || []).find(item => item.id === event.currentTarget.dataset.id);
    if (!card) return;
    this.setData({ preview: card });
    wx.pageScrollTo({ scrollTop: 0, duration: 0 });
  },
  closePreview() { this.setData({ preview: null }); },
  use(event) {
    if (this.data.returning || !requireLogin()) return;
    const app = getApp(), id = event.currentTarget.dataset.id;
    if (this._catalogGeneration !== app._generation || !(this._catalog || []).some(card => card.id === id)) return;
    const card=(this._catalog || []).find(card=>card.id===id);
    if(card.studioMode){const sessionId=this._origin?this._origin.sessionId:app.state&&app.state.activeSessionId;wx.navigateTo({url:'/pages/sticker-studio/index?from=template&styleId=lightmao&mode='+card.studioMode+(sessionId?'&sessionId='+encodeURIComponent(sessionId):'')});return;}
    if ((this._catalog || []).find(card => card.id === id).output === 'sticker-pack') {
      const sessionId = this._origin ? this._origin.sessionId : app.state && app.state.activeSessionId;
      wx.navigateTo({ url: '/pages/stickers/index' + (sessionId ? '?sessionId=' + encodeURIComponent(sessionId) : '') });
      return;
    }
    const selection = { id, generation: app._generation, sessionId: this._origin ? this._origin.sessionId : app.state && app.state.activeSessionId };
    app.pendingTemplate = selection;
    this.setData({ returning: true, error: '' });
    wx.switchTab({ url: '/pages/chat/index', fail: () => {
      if (app.pendingTemplate === selection) app.pendingTemplate = null;
      this.setData({ returning: false, error: '暂时无法打开创作页，请重试。' });
    } });
  },
});
