const { shareAppMessage } = require('../../utils/share');
const { appearanceData } = require('../../utils/appearance');
Page({
  onShareAppMessage: shareAppMessage,
  data: appearanceData(),
  onLoad() { this.openResources(); },
  openResources() { getApp().pendingResourceSection = 'films'; wx.switchTab({ url: '/pages/library/index' }); },
});
