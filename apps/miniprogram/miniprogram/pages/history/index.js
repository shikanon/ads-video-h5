const { beijingTime, active } = require('../../utils/view');
const { notify, withSession, hide } = require('../../utils/page');
Page({
  data: { sessions: [], more: false, busy: false },
  onLoad() { this._limit = 40; },
  onShow() { withSession(this, this.render); }, onHide() { hide(this); }, onUnload() { hide(this); },
  render(state) { this.setData({ sessions: state.sessions.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, this._limit).map(session => ({ id: session.id, title: session.title, date: beijingTime(session.updatedAt), selected: session.id === state.activeSessionId, count: session.messages.length, running: state.jobs.some(job => job.sessionId === session.id && active(job)) })), more: state.sessions.length > this._limit }); },
  more() { this._limit += 40; this.render(getApp().state); },
  async activate(event) {
    if (this.data.busy) return; this.setData({ busy: true });
    try { await getApp().mutate('/api/sessions/' + encodeURIComponent(event.currentTarget.dataset.id) + '/activate', {}); wx.switchTab({ url: '/pages/chat/index' }); } catch (error) { notify(error); } finally { this.setData({ busy: false }); }
  },
  async create() { if (this.data.busy) return; this.setData({ busy: true }); try { await getApp().mutate('/api/sessions', {}); wx.switchTab({ url: '/pages/chat/index' }); } catch (error) { notify(error); } finally { this.setData({ busy: false }); } },
});
