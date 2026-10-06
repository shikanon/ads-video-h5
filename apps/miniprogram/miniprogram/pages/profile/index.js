const { points } = require('../../utils/view');
const { notify, withSession, hide } = require('../../utils/page');
Page({
  data: { user: null, balance: '0.00', canCheckIn: false, sessions: 0, films: 0, media: 0, loggingOut: false },
  onShow() { withSession(this, this.render); if (getApp().client.hasSession()) this.me().catch(notify); },
  onHide() { hide(this); }, onUnload() { hide(this); },
  async me() { const result = await getApp().client.request('/api/auth/me'); getApp().user = result.user; this.setData({ user: result.user }); },
  render(state) { this.setData({ user: getApp().user, balance: points(state.credits && state.credits.balance || 0), canCheckIn: Boolean(state.credits && state.credits.canCheckIn), sessions: state.sessions.length, films: state.artifacts.filter(item => item.kind === 'video').length, media: state.media.filter(item => !item.character).length }); },
  navigate(event) { wx.navigateTo({ url: '/pages/' + event.currentTarget.dataset.page + '/index' }); },
  legal(event) { wx.navigateTo({ url: '/pages/legal/index?type=' + event.currentTarget.dataset.type }); },
  async logout() {
    if (this.data.loggingOut) return; this.setData({ loggingOut: true });
    try { await getApp().client.request('/api/auth/logout', {}); } catch (error) { notify(error); }
    finally { getApp().expired(); }
  },
});
