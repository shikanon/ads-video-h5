import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { capturePage, miniRoot, miniRequire, loadNativeApp, waitFor } from './fixtures/nativeClient';

test('every native page shares the public home without leaking the active account, conversation or file', async () => {
  const config = JSON.parse(await readFile(path.join(miniRoot, 'app.json'), 'utf8'));
  const privateId = 'private-qa-account-session-file';
  const platform = { request: assert.fail, login: assert.fail, navigateTo: assert.fail };
  const app = { state: { activeSessionId: privateId }, user: { id: privateId } };
  for (const route of config.pages) {
    const page = await capturePage(route.split('/')[1], app, platform);
    page.data = { sessionId: privateId, prompt: privateId, item: { id: privateId, name: privateId, url: 'https://private.example/' + privateId } };
    assert.equal(typeof page.onShareAppMessage, 'function', route);
    const card = page.onShareAppMessage({ from: 'menu', target: { dataset: { id: privateId } } });
    assert.equal(card.path, '/pages/chat/index', route);
    assert.equal(card.title, '轻喵LightMao｜视频创作');
    assert.equal(card.imageUrl, '/assets/lightmao-logo.png');
    assert.equal(JSON.stringify(card).includes(privateId), false);
    assert.equal(card.path.includes('?'), false);
    if (config.tabBar.list.some((tab: any) => tab.pagePath === route)) {
      const timeline = page.onShareTimeline();
      assert.equal(timeline.query, '');
      assert.equal(timeline.title, '轻喵LightMao｜视频创作');
      assert.equal(timeline.imageUrl, '/assets/lightmao-logo.png');
      assert.equal(JSON.stringify(timeline).includes(privateId), false);
    } else {
      assert.equal(page.onShareTimeline, undefined, 'private/parameterized pages do not publish a timeline link');
    }
    card.title = privateId;
    assert.equal(page.onShareAppMessage().title, '轻喵LightMao｜视频创作', 'each share returns a fresh public card');
  }
  const { PNG } = await import('pngjs');
  const logo = PNG.sync.read(await readFile(path.join(miniRoot, 'assets/lightmao-logo.png')));
  assert.equal(logo.width, 1024); assert.equal(logo.height, 1024);
});

test('a guest tab exposes both share menus before login without requesting network or permissions', async () => {
  const menus: any[] = [];
  const app = { client: { hasSession: () => false }, state: null };
  const page = await capturePage('library', app, { showShareMenu: (options: any) => menus.push(options), request: assert.fail, login: assert.fail, authorize: assert.fail });
  page.onLoad(); page.onShow();
  assert.deepEqual(Array.from(menus[0].menus), ['shareAppMessage', 'shareTimeline']);
  assert.equal(page.data.guest, true); page.onHide();
});

test('a video work preview remains public when an expired cached login is cleared',async t=>{
 const actual=miniRequire('./miniprogram/config.js'),storage=new Map(),requests:any[]=[],redirects:string[]=[],pages:any[]=[];
 storage.set('qingjian:wechat-session:v1:'+actual.apiBase,'qingjian_session='+'a'.repeat(43));
 const wx:any={getStorageSync:(k:string)=>storage.get(k),setStorageSync:(k:string,v:any)=>storage.set(k,v),removeStorageSync:(k:string)=>storage.delete(k),request:(o:any)=>requests.push(o),reLaunch:(o:any)=>{redirects.push(o.url);o.complete?.();}};
 const app=await loadNativeApp(wx,()=>pages);t.after(()=>app.onHide());const token='c'.repeat(48);app.onShow({path:'pages/video-share/index',query:{token}});const refreshing=app._refreshing,page=await capturePage('video-share',app,wx);page.route='pages/video-share/index';pages.push(page);page.onLoad({token});page.onShow();
 requests[0].success({statusCode:401,data:{error:'登录过期'},header:{}});await refreshing.catch(()=>{});const data={share:{name:'好友视频',videoUrl:'/api/video-shares/'+token+'/video',coverUrl:'/api/video-shares/'+token+'/cover'}};requests[1].success({statusCode:200,data,header:{}});await waitFor(()=>requests.length===3);assert.equal(requests[2].header.Cookie,undefined);requests[2].success({statusCode:200,data,header:{}});await waitFor(()=>page.data.share?.name==='好友视频');assert.equal(redirects.length,0);assert.equal(app.client.hasSession(),false);page.onHide();
});


test('explicit sticker template sharing passes only a public mode; recipients create with their own account',async()=>{
  for(const name of ['sticker-studio','stickers']){
    const page=await capturePage(name,{state:{activeSessionId:'private-session'}},{});
    page.data={project:{id:'private-project',recipe:{name:'private-name',referenceMediaId:'private-photo',style:'private-style'}},pack:{id:'private-pack'}};
    for(const mode of ['static','dynamic']){
      const card=page.onShareAppMessage({from:'button',target:{dataset:{stickerTemplate:'true',stickerMode:mode}}});
      assert.equal(card.path,'/pages/sticker-studio/index?mode='+mode+'&from=template');assert.equal(JSON.stringify(card).includes('private-'),false);assert.equal(card.imageUrl,'/assets/lightmao-logo.png');
      const recipient=await capturePage('sticker-studio',{_generation:1,state:null,client:{hasSession:()=>false}}, {showShareMenu(){},setNavigationBarTitle(){}});recipient.onLoad({mode,from:'template'});recipient.onShow();assert.equal(recipient.data.mode,mode);assert.equal(recipient.data.fromTemplate,true);assert.equal(recipient.data.guest,true);assert.equal(recipient.data.referenceId,'');recipient.onUnload();
    }
  }
});

test('guest template login returns to the chosen mode and never accepts an arbitrary return URL',async()=>{
 const navigations:any[]=[],platform={navigateTo:(o:any)=>navigations.push(o.url),redirectTo:(o:any)=>navigations.push(o.url),switchTab:(o:any)=>navigations.push(o.url)};
 const app:any={client:{hasSession:()=>false,wechatLogin:async()=>({user:{id:'own-account'}})},refresh:async()=>({})};
 const studio=await capturePage('sticker-studio',app,platform);studio.onLoad({mode:'static',from:'template'});studio.login();assert.equal(navigations.pop(),'/pages/auth/index?stickerMode=static&stickerStyle=lightmao');
 const auth=await capturePage('auth',app,platform);auth.onLoad({stickerMode:'static'});await auth.submit();assert.equal(navigations.pop(),'/pages/sticker-studio/index?mode=static&from=template');assert.equal(app.user.id,'own-account');
 auth.onLoad({stickerMode:'https://untrusted.test/'});await auth.submit();assert.equal(navigations.pop(),'/pages/chat/index');
});

test('an expired cached login cannot redirect a public friend preview away, while private pages still reset safely',async t=>{
 const config=miniRequire('./miniprogram/config'),requests:any[]=[],redirects:any[]=[],pages:any[]=[],storage=new Map();
 storage.set('qingjian:wechat-session:v1:'+config.apiBase,'qingjian_session='+'a'.repeat(43));
 const wx:any={getStorageSync:(key:string)=>storage.get(key),setStorageSync:(key:string,value:any)=>storage.set(key,value),removeStorageSync:(key:string)=>storage.delete(key),request:(o:any)=>requests.push(o),reLaunch:(o:any)=>{redirects.push(o.url);o.complete?.();}};
 const app=await loadNativeApp(wx,()=>pages);t.after(()=>app.onHide());const token='b'.repeat(48);
 app.onShow({path:'pages/sticker-share/index',query:{token}});const refreshing=app._refreshing;
 const page=await capturePage('sticker-share',app,wx);page.route='pages/sticker-share/index';pages.push(page);page.onLoad({token});page.onShow();
 requests[0].success({statusCode:401,data:{error:'登录已过期'},header:{}});await refreshing.catch(()=>{});
 requests[1].success({statusCode:200,data:{share:{name:'好友作品',mode:'static',styleId:'round',count:1,items:[{id:'01',thumbnailUrl:'/api/sticker-shares/'+token+'/items/01/thumb'}]}},header:{}});
 await waitFor(()=>requests.length===3);assert.equal(requests[2].header.Cookie,undefined);
 requests[2].success({statusCode:200,data:{share:{name:'好友作品',mode:'static',styleId:'round',count:1,items:[]}},header:{}});
 await waitFor(()=>page.data.share?.name==='好友作品');assert.equal(app.client.hasSession(),false);assert.equal(redirects.length,0);page.onHide();
 pages.pop();app.expired();assert.equal(redirects.length,0,'cold public entry also survives before page creation');
 pages.push({route:'pages/chat/index'});app.expired();assert.equal(redirects[0],'/pages/chat/index');
});
