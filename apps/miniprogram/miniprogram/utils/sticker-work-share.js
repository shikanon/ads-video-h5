const {notify}=require('./page');
function projectId(page){return page.data.project?.id||page.data.pack?.projectId;}
async function prepareWorkShare(page,app,wx){
 const id=projectId(page),generation=app._generation;if(!id||page.data.sharing)return;
 const allow=await new Promise(resolve=>wx.showModal({title:'创建作品预览',content:'好友可查看已完成的表情、套装名称与画风类型。角色原图、对话与账号信息不会公开。你可在此页面关闭作品分享。',success:r=>resolve(r.confirm),fail:()=>resolve(false)}));
 if(!allow||generation!==app._generation||!page._visible)return;page.setData({sharing:true});
 try{const result=await app.client.request('/api/sticker-projects/'+id+'/shares',{});if(generation===app._generation&&page._visible&&projectId(page)===id)page.setData({shareToken:result.token});}catch(error){if(generation===app._generation)notify(error);}finally{if(generation===app._generation)page.setData({sharing:false});}
}
async function loadWorkShares(page,app){const id=projectId(page),generation=app._generation;if(!id)return;try{const result=await app.client.request('/api/sticker-projects/'+id+'/shares');if(page._visible&&generation===app._generation&&projectId(page)===id)page.setData({shareToken:result.shares[0]?.token||''});}catch{}}
async function revokeWorkShares(page,app,wx){const id=projectId(page),generation=app._generation;if(!id)return;try{const result=await app.client.request('/api/sticker-projects/'+id+'/shares');for(const share of result.shares)await app.client.request('/api/sticker-projects/'+id+'/shares/'+share.token,{},'DELETE');if(generation===app._generation){page.setData({shareToken:''});wx.showToast({title:'作品分享已关闭',icon:'none'});}}catch(error){if(generation===app._generation)notify(error);}}
function workShare(event,page){if(event?.from!=='button'||event.target?.dataset?.stickerWork!=='true'||!page.data.shareToken)return null;return {title:(page.data.project?.recipe.name||page.data.pack?.name||'我的表情')+'｜作品预览',path:'/pages/sticker-share/index?token='+page.data.shareToken,imageUrl:page.data.samples?.[0]?.image||'/assets/lightmao-logo.png'};}
module.exports={prepareWorkShare,loadWorkShares,revokeWorkShares,workShare};
