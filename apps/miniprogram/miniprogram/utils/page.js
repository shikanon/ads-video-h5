function notify(error) { wx.showToast({ title: error && error.message || '操作失败，请重试。', icon: 'none', duration: 2800 }); }
function withSession(page, refresh) {
  page._visible = true;
  const app = getApp();
  if (!app.client.hasSession()) { app.expired(); return; }
  page._unsubscribe = app.subscribe(() => { if (page._visible) refresh.call(page, app.state); });
  if (app.state) refresh.call(page, app.state);
  app.refresh().catch(notify);
}
function hide(page) { page._visible = false; if (page._unsubscribe) page._unsubscribe(); page._unsubscribe = null; }
function privacy() { return new Promise((resolve, reject) => { if (wx.requirePrivacyAuthorize) wx.requirePrivacyAuthorize({ success: resolve, fail: () => reject(new Error('同意隐私指引后，才可使用素材或语音功能。')) }); else resolve(); }); }
module.exports = { notify, withSession, hide, privacy };
