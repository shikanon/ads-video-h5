Page({
  data: { privacy: true },
  onLoad(query) { this.setData({ privacy: query.type !== 'terms' }); wx.setNavigationBarTitle({ title: query.type === 'terms' ? '用户协议' : '隐私说明' }); },
  contract() { if (wx.openPrivacyContract) wx.openPrivacyContract({ fail: () => wx.showToast({ title: '小程序隐私指引尚未配置。', icon: 'none' }) }); },
});
