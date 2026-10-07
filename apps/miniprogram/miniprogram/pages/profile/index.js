const { points } = require('../../utils/view');
const { notify, withSession, hide } = require('../../utils/page');
Page({
  data: { user: null, nickname: '', savingName: false, balance: '0.00', canCheckIn: false, sessions: 0, films: 0, media: 0, loggingOut: false },
  onShow() { withSession(this, this.render); if (getApp().client.hasSession()) this.me().catch(notify); },
  onHide() { hide(this); }, onUnload() { hide(this); },
  async me() { const result = await getApp().client.request('/api/auth/me'); getApp().user = result.user; this.setData({ user: result.user, ...(!this._editingNickname ? { nickname: result.user.displayName } : {}) }); },
  render(state) { const user = getApp().user; this.setData({ user, ...(!this._editingNickname && user ? { nickname: user.displayName } : {}), balance: points(state.credits && state.credits.balance || 0), canCheckIn: Boolean(state.credits && state.credits.canCheckIn), sessions: state.sessions.length, films: state.artifacts.filter(item => item.kind === 'video').length, media: state.media.filter(item => !item.character).length }); },
  nickname(event) { this._editingNickname = true; this.setData({ nickname: event.detail.value }); },
  async saveName() {
    if (this.data.savingName) return;
    const displayName = this.data.nickname.trim();
    if (!displayName || displayName.length > 40) { wx.showToast({ title: '请填写 1 至 40 个字符的昵称', icon: 'none' }); return; }
    this.setData({ savingName: true });
    try { const result = await getApp().client.request('/api/auth/wechat/profile', { displayName }, 'PATCH'); getApp().user = result.user; this._editingNickname = false; this.setData({ user: result.user, nickname: result.user.displayName }); wx.showToast({ title: '昵称已保存', icon: 'success' }); }
    catch (error) { notify(error); }
    finally { this.setData({ savingName: false }); }
  },
  navigate(event) { wx.navigateTo({ url: '/pages/' + event.currentTarget.dataset.page + '/index' }); },
  legal(event) { wx.navigateTo({ url: '/pages/legal/index?type=' + event.currentTarget.dataset.type }); },
  async logout() {
    if (this.data.loggingOut) return; this.setData({ loggingOut: true });
    try { await getApp().client.request('/api/auth/logout', {}); } catch (error) { notify(error); }
    finally { getApp().expired(); }
  },
});
