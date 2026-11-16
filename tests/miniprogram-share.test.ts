import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { capturePage, miniRoot } from './fixtures/nativeClient';

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
 const studio=await capturePage('sticker-studio',app,platform);studio.onLoad({mode:'static',from:'template'});studio.login();assert.equal(navigations.pop(),'/pages/auth/index?stickerMode=static&stickerStyle=soft');
 const auth=await capturePage('auth',app,platform);auth.onLoad({stickerMode:'static'});await auth.submit();assert.equal(navigations.pop(),'/pages/sticker-studio/index?mode=static&from=template');assert.equal(app.user.id,'own-account');
 auth.onLoad({stickerMode:'https://untrusted.test/'});await auth.submit();assert.equal(navigations.pop(),'/pages/chat/index');
});
