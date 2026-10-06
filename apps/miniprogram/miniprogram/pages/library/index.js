const { mediaView } = require('../../utils/view');
const { notify, withSession, hide } = require('../../utils/page');
const { chooseFiles, uploadMedia } = require('../../utils/upload');
Page({
  data: { items: [], filter: 'all', more: false, uploading: false, uploadText: '', count: 0 },
  onLoad() { this._limit = 30; },
  onShow() { withSession(this, this.render); }, onHide() { hide(this); }, onUnload() { hide(this); },
  render(state) {
    const all = state.media.filter(item => !item.character && (this.data.filter === 'all' || item.kind === this.data.filter)).slice().reverse();
    this.setData({ items: all.slice(0, this._limit).map(item => mediaView(item, getApp().client)), more: all.length > this._limit, count: all.length });
  },
  filter(event) { this._limit = 30; this.setData({ filter: event.currentTarget.dataset.kind }); this.render(getApp().state); },
  more() { this._limit += 30; this.render(getApp().state); },
  play(event) { wx.navigateTo({ url: '/pages/player/index?type=media&id=' + encodeURIComponent(event.currentTarget.dataset.id) }); },
  use(event) { getApp().pendingAttachments = [event.currentTarget.dataset.id]; wx.switchTab({ url: '/pages/chat/index' }); },
  async upload() {
    if (this.data.uploading) return;
    const audio = await new Promise(resolve => wx.showActionSheet({ itemList: ['相册 / 拍摄视频或图片', '聊天文件 / 音频'], success: result => resolve(result.tapIndex === 1), fail: () => resolve(null) }));
    if (audio === null) return;
    try {
      const files = await chooseFiles(audio); if (!files.length) return;
      this.setData({ uploading: true });
      await uploadMedia(getApp(), files, (at, total, percent) => this.setData({ uploadText: '上传 ' + at + '/' + total + ' · ' + percent + '%' }));
      wx.showToast({ title: '素材已添加', icon: 'success' });
    } catch (error) { notify(error); }
    finally { this.setData({ uploading: false, uploadText: '' }); }
  },
  async remove(event) {
    const id = event.currentTarget.dataset.id;
    const confirm = await new Promise(resolve => wx.showModal({ title: '删除素材？', content: '此操作会从账号素材库删除该文件，请确认无需继续使用。', confirmText: '删除', confirmColor: '#b55841', success: result => resolve(result.confirm), fail: () => resolve(false) }));
    if (!confirm) return;
    try { await getApp().mutate('/api/media/' + encodeURIComponent(id), undefined, 'DELETE'); } catch (error) { notify(error); }
  },
});
