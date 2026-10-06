const { notify } = require('../../utils/page');
Page({
  data: { register: false, email: '', password: '', displayName: '', code: '', busy: false, resend: 0, error: '' },
  async onShow() {
    const app = getApp(); app._redirecting = false;
    if (app.client.hasSession()) {
      try { const result = await app.client.request('/api/auth/me'); app.user = result.user; await app.refresh(); wx.switchTab({ url: '/pages/chat/index' }); }
      catch (error) { if (error.status === 401) app.reset(); else this.setData({ error: error.message }); }
    }
  },
  onUnload() { clearInterval(this._countdown); },
  input(event) { this.setData({ [event.currentTarget.dataset.field]: event.detail.value, error: '' }); },
  toggle() { this.setData({ register: !this.data.register, password: '', code: '', error: '' }); },
  async code() {
    if (this.data.resend || this.data.busy) return;
    this.setData({ busy: true, error: '' });
    try { await getApp().client.request('/api/auth/send-code', { email: this.data.email }); this.setData({ resend: 60 }); this._countdown = setInterval(() => { if (this.data.resend <= 1) clearInterval(this._countdown); this.setData({ resend: Math.max(0, this.data.resend - 1) }); }, 1000); wx.showToast({ title: '验证码已发送', icon: 'success' }); }
    catch (error) { this.setData({ error: error.message }); }
    finally { this.setData({ busy: false }); }
  },
  async submit() {
    if (this.data.busy) return;
    const { email, password, register, displayName, code } = this.data;
    if (!email.trim() || !password || register && (!displayName.trim() || !/^\d{6}$/.test(code))) { this.setData({ error: '请完整填写账号信息。' }); return; }
    this.setData({ busy: true, error: '' });
    try {
      const app = getApp(), result = await app.client.request(register ? '/api/auth/register' : '/api/auth/login', { email, password, displayName, verificationCode: code });
      if (!app.client.hasSession()) throw new Error('登录凭据未返回，请重试登录。');
      app.user = result.user; await app.refresh(); this.setData({ password: '', code: '' }); wx.switchTab({ url: '/pages/chat/index' });
    } catch (error) { this.setData({ error: error.message }); }
    finally { this.setData({ busy: false }); }
  },
  legal(event) { wx.navigateTo({ url: '/pages/legal/index?type=' + event.currentTarget.dataset.type }); },
});
