Component({
  data: { visible: false },
  methods: {
    open(resolve) { this._resolvers = (this._resolvers || []).concat(resolve); this.setData({ visible: true }); },
    agree() { (this._resolvers || []).forEach(resolve => resolve({ buttonId: 'qingjian-privacy-agree', event: 'agree' })); this._resolvers = []; this.setData({ visible: false }); },
    disagree() { (this._resolvers || []).forEach(resolve => resolve({ event: 'disagree' })); this._resolvers = []; this.setData({ visible: false }); },
    policy() { wx.openPrivacyContract({ fail: () => wx.showToast({ title: '请在小程序后台配置隐私指引。', icon: 'none' }) }); },
    noop() {},
  },
});
