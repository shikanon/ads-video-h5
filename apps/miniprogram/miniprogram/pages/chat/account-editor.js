const { notify, privacy, requireLogin } = require('../../utils/page');
const { hydrateAccountAvatar } = require('../../utils/account-avatar');

const data = { avatarEditor: false, nameEditor: false, nickname: '', savingAvatar: false, savingName: false };

function saving(page) {
  return page.data.savingAvatar || page.data.savingName;
}

function updateAccount(page, app, user) {
  if (app.applyAccount) app.applyAccount(user);
  else app.user = user;
  hydrateAccountAvatar(page, { account: user }, app);
  page.setData({ hasAvatar: Boolean(user.avatarUrl) });
}

const methods = {
  editAvatar() {
    if (saving(this) || !requireLogin()) return;
    if (!this.data.canAvatar) { notify(Error('当前服务暂不支持修改头像。')); return; }
    this.setData({ avatarEditor: true, nameEditor: false, focus: false });
  },
  editName() {
    if (saving(this) || !requireLogin()) return;
    const app = getApp();
    const user = app.state?.account || app.user;
    this.setData({ nameEditor: true, avatarEditor: false, nickname: user?.displayName || '', focus: false });
  },
  closeEditors() {
    if (!saving(this)) this.setData({ avatarEditor: false, nameEditor: false, nickname: '' });
  },
  chooseAvatar(event) {
    const file = event.detail?.avatarUrl;
    if (file) return this.saveAvatar(file);
  },
  async customAvatar() {
    if (saving(this) || !requireLogin()) return;
    const app = getApp(), generation = app._generation;
    this.setData({ avatarEditor: false });
    try {
      await privacy();
      if (generation !== app._generation) return;
      const result = await new Promise((resolve, reject) => wx.chooseMedia({
        count: 1, mediaType: ['image'], sizeType: ['original'], sourceType: ['album', 'camera'],
        success: resolve,
        fail: error => /cancel/i.test(error.errMsg || '') ? resolve(null) : reject(Error('未能选择头像，请重试。')),
      }));
      if (generation !== app._generation) return;
      const file = result?.tempFiles?.[0];
      if (!file) return;
      if (file.size > 4 * 1024 * 1024) { notify(Error('请选择一张不超过 4 MB 的头像。')); return; }
      return this.saveAvatar(file.tempFilePath);
    } catch (error) {
      if (generation === app._generation) notify(error);
    }
  },
  async saveAvatar(file) {
    if (saving(this) || !requireLogin()) return;
    const app = getApp(), generation = app._generation;
    this.setData({ savingAvatar: true });
    try {
      await privacy();
      if (generation !== app._generation) return;
      const result = await app.client.upload('/api/account/avatar', file, 'avatar');
      if (generation !== app._generation) return;
      updateAccount(this, app, result.user);
      this.setData({ avatarEditor: false });
      wx.showToast({ title: '头像已更新', icon: 'success' });
    } catch (error) {
      if (generation === app._generation) notify(error);
    } finally {
      if (generation === app._generation) this.setData({ savingAvatar: false });
    }
  },
  async removeAvatar() {
    if (saving(this) || !requireLogin()) return;
    const app = getApp(), generation = app._generation;
    this.setData({ savingAvatar: true });
    try {
      const confirmed = await new Promise(resolve => wx.showModal({
        title: '移除头像？', content: '恢复默认头像。', confirmText: '移除',
        success: result => resolve(result.confirm), fail: () => resolve(false),
      }));
      if (!confirmed || generation !== app._generation) return;
      const result = await app.client.request('/api/account/avatar', undefined, 'DELETE');
      if (generation !== app._generation) return;
      updateAccount(this, app, result.user);
      this.setData({ avatarEditor: false });
    } catch (error) {
      if (generation === app._generation) notify(error);
    } finally {
      if (generation === app._generation) this.setData({ savingAvatar: false });
    }
  },
  nickname(event) { this.setData({ nickname: event.detail.value }); },
  async saveName() {
    if (saving(this) || !requireLogin()) return;
    const app = getApp(), generation = app._generation;
    const displayName = this.data.nickname.trim();
    if (!displayName || displayName.length > 40) {
      wx.showToast({ title: '请填写 1 至 40 个字符的昵称', icon: 'none' });
      return;
    }
    this.setData({ savingName: true });
    try {
      const result = await app.client.request('/api/auth/wechat/profile', { displayName }, 'PATCH');
      if (generation !== app._generation) return;
      updateAccount(this, app, result.user);
      this.setData({ nickname: result.user.displayName, nameEditor: false });
      wx.showToast({ title: '昵称已保存', icon: 'success' });
    } catch (error) {
      if (generation === app._generation) notify(error);
    } finally {
      if (generation === app._generation) this.setData({ savingName: false });
    }
  },
};

module.exports = { data, methods };
