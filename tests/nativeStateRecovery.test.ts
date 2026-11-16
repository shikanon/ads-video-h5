import test from 'node:test';
import assert from 'node:assert/strict';
import { loadNativeApp,capturePage,recorderFixture,miniRequire } from './fixtures/nativeClient';
const config=miniRequire('./miniprogram/config');
const initial=()=>({account:{id:'owner',authProvider:'wechat',displayName:'Owner'},features:{conversationModes:true},activeSessionId:'s',sessions:[{id:'s',title:'Current',mode:'chat',messages:[{id:'u',role:'user',text:'start',createdAt:'2026-11-16T00:00:00Z',attachmentIds:[]}]}],media:[] as any[],artifacts:[],jobs:[] as any[],models:[],settings:{},credits:{balance:2000}});
async function fixture(){const requests:any[]=[],uploads:any[]=[],storage=new Map();storage.set('qingjian:wechat-session:v1:'+config.apiBase,'qingjian_session='+'a'.repeat(43));const wx:any={getStorageSync:(k:string)=>storage.get(k),setStorageSync:(k:string,v:any)=>storage.set(k,v),removeStorageSync:(k:string)=>storage.delete(k),onNeedPrivacyAuthorization(){},request(o:any){requests.push(o)},uploadFile(o:any){uploads.push(o);return {onProgressUpdate(){}}},getRecorderManager:()=>recorderFixture(),showToast(){},getWindowInfo:()=>({windowWidth:390,windowHeight:700}),showShareMenu(){}};const app=await loadNativeApp(wx);app.apply(initial());app.client.download=async()=>'/cache/image';const page=await capturePage('chat',app,wx);page.onLoad();page._visible=true;app.subscribe(()=>page.render(app.state));page.render(app.state);return {app,page,wx,requests,uploads};}
test('an old poll cannot remove uploaded images, selected attachments or a newly started studio task',async t=>{
 const f=await fixture();t.after(()=>{f.page.onUnload();f.app.onHide();});const refresh=f.app.refresh(),{uploadMedia}=miniRequire('./miniprogram/utils/upload');
 const uploading=uploadMedia(f.app,[{path:'/role.png',size:1000}],()=>{}),fresh=initial();fresh.media=[{id:'image',kind:'image',name:'Role',origin:'upload',url:config.apiBase+'/media/image'}];
 f.uploads[0].success({statusCode:200,data:JSON.stringify({...fresh,uploadedMediaIds:['image']}),header:{}});const ids=await uploading;f.page.addAttachments(ids);f.page.render(f.app.state);
 f.requests[0].success({statusCode:200,data:initial(),header:{}});await refresh;assert.equal(f.app.state.media[0].id,'image');assert.equal(f.page.data.attachmentIds.join(','),'image');
 f.requests.length=0;const polling=f.app.refresh(),running=initial();running.jobs=[{id:'job',sessionId:'s',status:'running',kind:'export',createdAt:'2026-11-16T00:00:00Z',updatedAt:'2026-11-16T00:00:00Z'}];f.app.commit(running);
 f.requests[0].success({statusCode:200,data:initial(),header:{}});await polling;assert.equal(f.page.data.running,true);assert.equal(f.app.state.jobs[0].id,'job');
});
test('sent images remain visible as attachments and account-scoped drafts survive reopening',async t=>{
 const f=await fixture();t.after(()=>{f.page.onUnload();f.app.onHide();});const s=initial();s.media=[{id:'image',kind:'image',name:'Role',url:config.apiBase+'/media/image'}];(s.sessions[0].messages[0] as any).attachmentIds=['image'];f.app.commit(s);
 assert.equal(f.page.data.messageAttachments[0].mediaId,'image');assert.equal(f.page.data.messages[0].attachments[0].id,'image');
 (s.sessions[0].messages as any[]).push({...s.sessions[0].messages[0],id:'u2'});f.app.commit(s);assert.equal(f.page.data.messageAttachments.length,2);assert.notEqual(f.page.data.messageAttachments[0].id,f.page.data.messageAttachments[1].id,'repeated image attachments have separate message keys');
 f.page.setData({prompt:'角色设定与下一段剧情',attachmentIds:['image'],cursor:8});f.page.onHide();const second=await capturePage('chat',f.app,f.wx);second.onLoad();second.render(f.app.state);assert.equal(second.data.prompt,'角色设定与下一段剧情');assert.equal(second.data.attachmentIds[0],'image');second.onUnload();
 const {readDrafts}=miniRequire('./miniprogram/utils/chat-drafts');assert.equal(Object.keys(readDrafts(f.wx,'stranger')).length,0);
});
