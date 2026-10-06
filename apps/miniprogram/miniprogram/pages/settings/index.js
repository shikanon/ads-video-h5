const { notify, withSession, hide } = require('../../utils/page');
Page({
  data: { models: [], index: 0, current: '', default: '', busy: false, author: '' },
  onShow() { withSession(this, this.render); }, onHide() { hide(this); }, onUnload() { hide(this); },
  render(state) {
    const models = state.models.filter(model => model.enabled && model.kind === 'text').map(model => ({ id: model.id, name: model.name }));
    const session = state.sessions.find(item => item.id === state.activeSessionId);
    const current = models.find(model => model.id === (session && session.modelId)) || models.find(model => model.id === state.settings.defaultModelId);
    const author = state.media.find(item => item.id === state.settings.authorAvatarId);
    this.setData({ models, index: Math.max(0, models.findIndex(model => model.id === (current && current.id))), current: current && current.name || '由服务端选择', default: (models.find(model => model.id === state.settings.defaultModelId) || {}).name || '由服务端选择', author: author && author.name || '暂未设置' });
  },
  async change(event) {
    if (this.data.busy) return;
    const model = this.data.models[Number(event.detail.value)]; if (!model) return;
    this.setData({ busy: true });
    try { await getApp().mutate('/api/settings', { defaultModelId: model.id, applyToCurrentSession: true }, 'PATCH'); wx.showToast({ title: '设置已同步', icon: 'success' }); }
    catch (error) { notify(error); } finally { this.setData({ busy: false }); }
  },
  credits() { wx.navigateTo({ url: '/pages/credits/index' }); },
  legal(event) { wx.navigateTo({ url: '/pages/legal/index?type=' + event.currentTarget.dataset.type }); },
  h5() { wx.setClipboardData({ data: 'https://video.shikanon.com/' }); },
});
