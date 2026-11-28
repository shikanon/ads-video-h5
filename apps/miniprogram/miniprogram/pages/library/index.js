const { appearanceData } = require('../../utils/appearance');
const { shareAppMessage, shareTimeline } = require('../../utils/share');
const { points } = require('../../utils/view');
const { withSession, hide, requireLogin } = require('../../utils/page');
const { collectionOf } = require('../../utils/media-collections');

Page({
  onShareAppMessage: shareAppMessage,
  onShareTimeline: shareTimeline,
  data: Object.assign(appearanceData(), {
    materialCount: 0,
    filmCount: 0,
    version: require('../../utils/version'),
    balance: '0.00',
    dailyReward: '1,000',
    canCheckIn: false,
  }),
  onShow() { withSession(this, this.render); },
  onHide() { hide(this); },
  onUnload() { hide(this); },
  render(state) {
    const credits = state.credits || {};
    this.setData({
      materialCount: state.media.filter(item => !item.character && collectionOf(item) === 'library').length,
      filmCount: state.artifacts.filter(item => !item.productionOnly).length,
      balance: points(credits.balance || 0),
      dailyReward: points(credits.dailyGrant === undefined ? 1000 : credits.dailyGrant).replace(/\.00$/, ''),
      canCheckIn: Boolean(credits.canCheckIn),
    });
  },
  credits() {
    if (requireLogin()) wx.navigateTo({ url: '/pages/credits/index' });
  },
});
