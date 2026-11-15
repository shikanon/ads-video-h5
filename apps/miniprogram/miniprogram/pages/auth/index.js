const { appearanceData } = require('../../utils/appearance');
const { shareAppMessage } = require("../../utils/share");
Page({
  onShareAppMessage: shareAppMessage,
  data: Object.assign(appearanceData(), { busy: false, error: '' }),
  onLoad(query){this._stickerMode=['static','dynamic'].includes(query.stickerMode)?query.stickerMode:null;},
  goAfterLogin(){if(this._stickerMode)wx.redirectTo({url:'/pages/sticker-studio/index?mode='+this._stickerMode+'&from=template'});else wx.switchTab({url:'/pages/chat/index'});},
  async onShow() {
    if (getApp().applyAppearance) getApp().applyAppearance(this);
    const app = getApp(); app._redirecting = false;
    if (app.client.hasSession()) {
      try {
        const result = await app.client.request('/api/auth/me');
        if (!result.user || result.user.authProvider !== 'wechat') { app.reset(); return; }
        app.user = result.user; await app.refresh(); this.goAfterLogin();
      }
      catch (error) { if (error.status === 401) app.reset(); else this.setData({ error: error.message }); }
    }
  },
  async submit() {
    if (this.data.busy) return;
    this.setData({ busy: true, error: '' });
    try {
      const app = getApp(), result = await app.client.wechatLogin();
      app.user = result.user; await app.refresh(); this.goAfterLogin();
    } catch (error) { this.setData({ error: error.message }); }
    finally { this.setData({ busy: false }); }
  },
  browse() { wx.switchTab({ url: '/pages/chat/index' }); },
  legal(event) { wx.navigateTo({ url: '/pages/legal/index?type=' + event.currentTarget.dataset.type }); },
});
