// Share the public entry point only. Never attach the current conversation,
// media IDs, account information or authenticated download URLs.
function shareAppMessage() {
  return {
    title: '轻喵LightMao｜视频创作',
    path: '/pages/chat/index',
    imageUrl: '/assets/lightmao-logo.png',
  };
}
function shareTimeline() {
  // Timeline uses the current page; enable only on the four browsable tabs.
  // An explicit empty query removes any parameters from the incoming link.
  return { title: '轻喵LightMao｜视频创作', query: '', imageUrl: '/assets/lightmao-logo.png' };
}
function stickerTemplateShare(event) {
  if(event && event.from === 'button' && event.target && event.target.dataset && event.target.dataset.stickerTemplate === 'true') {
    const mode=event.target.dataset.stickerMode === 'static' ? 'static' : 'dynamic';
    return {title:'用自己的角色，制作'+(mode === 'static' ? '静态' : '动态')+'表情',path:'/pages/sticker-studio/index?mode='+mode+'&from=template',imageUrl:'/assets/lightmao-logo.png'};
  }
  return shareAppMessage();
}
module.exports = { shareAppMessage, shareTimeline, stickerTemplateShare };
