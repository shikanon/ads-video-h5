const { privacy } = require('./page');
async function chooseFiles(audio) {
  await privacy();
  return new Promise((resolve, reject) => {
    const fail = error => /cancel/.test(error.errMsg || '') ? resolve([]) : reject(new Error('无法选择素材，请检查相册或文件权限。'));
    if (audio) wx.chooseMessageFile({ count: 6, type: 'file', extension: ['mp3', 'wav', 'ogg'], success: result => resolve(result.tempFiles.map(file => ({ path: file.path, size: file.size }))), fail });
    else wx.chooseMedia({ count: 6, mediaType: ['image', 'video'], sourceType: ['album', 'camera'], maxDuration: 60,
      success: result => resolve(result.tempFiles.map(file => ({ path: file.tempFilePath, size: file.size }))), fail });
  });
}
async function uploadMedia(app, files, progress) {
  const ids = [];
  for (const [index, file] of files.entries()) {
    if (file.size > 100 * 1024 * 1024) throw new Error('单个素材不能超过 100 MB，请先压缩。');
    const existing = new Set(app.state ? app.state.media.map(item => item.id) : []);
    const state = await app.client.upload('/api/media', file.path, 'files', {}, percent => progress(index + 1, files.length, percent));
    app.apply(state);
    const created = state.media.filter(item => !existing.has(item.id) && item.origin === 'upload' && !item.character);
    // New server responses identify only this upload. With an older server,
    // an ambiguous concurrent upload is left in the library for manual picking.
    ids.push(...(Array.isArray(state.uploadedMediaIds) ? state.uploadedMediaIds : created.length === 1 ? [created[0].id] : []));
    progress(index + 1, files.length, 100);
  }
  return ids;
}
module.exports = { chooseFiles, uploadMedia };
