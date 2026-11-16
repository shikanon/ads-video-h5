function key(account) { return 'lightmao:chat-drafts:v1:' + account; }
function readDrafts(wx, account) {
  if(!account)return {};try{const value=wx.getStorageSync(key(account));if(!value||Date.now()-value.at>86400000||typeof value.drafts!=='object')return {};return value.drafts;}catch{return {};}
}
function writeDrafts(wx, account, drafts) {
  if(!account)return;try{const selected=Object.fromEntries(Object.entries(drafts).slice(-12).map(([id,d])=>[id,{prompt:String(d.prompt||'').slice(0,20000),cursor:d.cursor||0,attachmentIds:(d.attachmentIds||[]).slice(0,20),researchMode:d.researchMode||'auto',error:''}]));wx.setStorageSync(key(account),{at:Date.now(),drafts:selected});}catch{}
}
module.exports={readDrafts,writeDrafts};
