Page({
  data: { busy: false, error: '' },
  async onShow() {
    const app = getApp(); app._redirecting = false;
    if (app.client.hasSession()) {
      try {
        const result = await app.client.request('/api/auth/me');
        if (!result.user || result.user.authProvider !== 'wechat') { app.reset(); return; }
        app.user = result.user; await app.refresh(); wx.switchTab({ url: '/pages/chat/index' });
      }
      catch (error) { if (error.status === 401) app.reset(); else this.setData({ error: error.message }); }
    }
  },
  async submit() {
    if (this.data.busy) return;
    this.setData({ busy: true, error: '' });
    try {
      const app = getApp(), result = await app.client.wechatLogin();
      app.user = result.user; await app.refresh(); wx.switchTab({ url: '/pages/chat/index' });
    } catch (error) { this.setData({ error: error.message }); }
    finally { this.setData({ busy: false }); }
  },
  legal(event) { wx.navigateTo({ url: '/pages/legal/index?type=' + event.currentTarget.dataset.type }); },
});
