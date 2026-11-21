import test from 'node:test';
import assert from 'node:assert/strict';
import { capturePage, recorderFixture } from './fixtures/nativeClient';

const event = (dataset: Record<string, string>) => ({ currentTarget: { dataset } });
const template = (id = 'video-style-interface') => ({ id, name: '界面动效', description: '产品演示', skillName: id, defaults: { seconds: 12 } });
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

function fixture() {
  const calls: any[] = [];
  const state: any = { activeSessionId: 'one', sessions: [{ id: 'one', messages: [] }], media: [], artifacts: [], jobs: [], templates: [template()], models: [], settings: {} };
  const app: any = { _generation: 1, state, client: { hasSession: () => true, previewUrl: () => '', templateAssetUrl: () => '', request: async () => ({ templates: state.templates }) }, subscribe: () => () => {}, refresh: async () => state };
  const wx: any = { switchTab: (options: any) => calls.push(options), navigateTo: (options: any) => calls.push(options), showToast: (options: any) => calls.push(options), pageScrollTo() {}, showShareMenu() {}, getRecorderManager: recorderFixture };
  return { app, wx, state, calls };
}

test('tools template selection fills its own editable draft without sending or changing the chat',async()=>{
  const f=fixture(),chat=await capturePage('chat',f.app,f.wx);chat.onLoad();chat.onShow();chat.setData({prompt:'原对话草稿'});chat.onHide();
  const gallery=await capturePage('templates',f.app,f.wx);gallery.onLoad();gallery.onShow();await tick();await gallery.category(event({id:'video'}));
  gallery.chooseTemplate(event({id:template().id}));assert.match(gallery.data.prompt,/@界面动效/);assert.equal(f.state.jobs.length,0);assert.equal(f.app.pendingTemplate,undefined);assert.equal(f.calls.filter(c=>c.url==='/pages/chat/index').length,0);
  gallery.onHide();chat.onShow();assert.equal(chat.data.prompt,'原对话草稿');chat.onUnload();
});

test('a selection from the template tab waits for initial state and never applies to a different account or conversation', async () => {
  const f = fixture(), chat = await capturePage('chat', f.app, f.wx);
  chat.onLoad(); f.app.state = null;
  f.app.pendingTemplate = { id: template().id, generation: 1 };
  chat.onShow();
  assert.ok(f.app.pendingTemplate, 'state has not arrived yet');
  f.app.state = f.state; chat.render(f.state);
  assert.equal(chat.data.templateName, '界面动效');
  chat.setData({ prompt: '原草稿', templateName: '' });
  f.app.pendingTemplate = { id: template().id, generation: 1, sessionId: 'other' };
  chat.render(f.state); assert.equal(chat.data.prompt, '原草稿');
  assert.match(f.calls.at(-1).title, /会话已切换/);
  f.app.pendingTemplate = { id: template().id, generation: 0, sessionId: 'one' };
  chat.render(f.state); assert.equal(chat.data.prompt, '原草稿');
  chat.onUnload();
});

test('tool catalog preserves a usable selection on fetch failure and ignores stale account responses',{timeout:5000},async()=>{
 const f=fixture(),gallery=await capturePage('templates',f.app,f.wx);gallery.onLoad();gallery.onShow();await tick();await gallery.category(event({id:'video'}));const count=gallery.data.cards.length;
 f.app.client.request=async()=>{throw Error('离线');};await gallery.load();assert.equal(gallery.data.cards.length,count);assert.equal(gallery.data.error,'离线');
 let finish:any;f.app.client.request=route=>route.includes('/config')?Promise.resolve({}):route.endsWith('/sticker-packs')?Promise.resolve({packs:[]}):new Promise(r=>{finish=r;});const pending=gallery.load();f.app._generation++;f.app.client.hasSession=()=>false;gallery.onHide();gallery.onShow();finish({templates:[template('old-account')]});await pending;assert.equal(gallery.data.cards.some(c=>c.id==='old-account'),false);assert.ok(gallery.data.cards.length>0);assert.equal(gallery.data.guest,true);gallery.onHide();
});

test('unified resources keep independent filters and pagination and open the correct player kind', async () => {
  const f = fixture();
  const base = { kind: 'video', createdAt: '2026-11-14T00:00:00Z', url: '' };
  f.state.media = Array.from({ length: 35 }, (_, i) => ({ ...base, id: 'm' + i, name: '原片' + i }));
  f.state.artifacts = Array.from({ length: 35 }, (_, i) => ({ ...base, id: 'a' + i, name: '成片' + i }));
  f.state.jobs = [{ id: 'job', sessionId: 'one', status: 'running', progress: 30 }];
  const page = await capturePage('library', f.app, f.wx);
  page.onLoad(); page.onShow();
  page.filter(event({ kind: 'video' })); page.search({ detail: { value: '原片' } }); page.more();
  assert.equal(page.data.items.length, 35);
  page.section(event({ section: 'films' }));
  assert.equal(page.data.items.length, 30); assert.equal(page.data.query, ''); assert.equal(page.data.filter, 'all');
  assert.equal(page.data.jobs[0].id, 'job');
  page.play(event({ id: 'a1' })); assert.match(f.calls.at(-1).url, /type=artifact&id=a1$/);
  page.search({ detail: { value: '成片1' } }); assert.equal(page.data.count, 11);
  page.section(event({ section: 'materials' }));
  assert.equal(page.data.items.length, 35); assert.equal(page.data.query, '原片'); assert.equal(page.data.filter, 'video');
  assert.equal(page.data.jobs.length, 0);
  page.play(event({ id: 'm1' })); assert.match(f.calls.at(-1).url, /type=media&id=m1$/);
  page.section(event({ section: 'films' })); assert.equal(page.data.query, '成片1');
  page.onHide();
});

test('archive and legacy films entry points select the correct resource section', async () => {
  const f = fixture(), page = await capturePage('library', f.app, f.wx);
  page.onLoad(); page.onShow(); page.section(event({ section: 'films' })); page.onHide();
  f.app.pendingLibraryCollection = 'clips'; page.onShow();
  assert.equal(page.data.section, 'materials'); assert.equal(page.data.collection, 'clips');
  assert.equal(f.app.pendingLibraryCollection, null); page.onHide();
  const legacy = await capturePage('films', f.app, f.wx); legacy.onLoad();
  assert.equal(f.calls.at(-1).url, '/pages/library/index'); page.onShow();
  assert.equal(page.data.section, 'films'); assert.equal(f.app.pendingResourceSection, null); page.onHide();
});

test('late material thumbnail downloads cannot overwrite the film shown after a section switch', async () => {
  const f = fixture(); let finish: any;
  f.state.media = [{ id: 'same', kind: 'image', name: '素材', url: '/private/material' }];
  f.state.artifacts = [{ id: 'same', kind: 'video', name: '成片', createdAt: '2026-11-14', coverUrl: '/private/film' }];
  f.app.client.download = (source: string) => source === '/private/material' ? new Promise(resolve => { finish = resolve; }) : Promise.resolve('film-cover');
  const page = await capturePage('library', f.app, f.wx); page.onLoad(); page.onShow();
  page.section(event({ section: 'films' })); await tick();
  finish('material-cover'); await tick();
  assert.equal(page.data.items[0].cover, 'film-cover');
  assert.equal(page.data.items[0].coverSource, '/private/film'); page.onHide();
});

test('news and editing starters fill a local tool prompt without starting a paid task',async()=>{
 const f=fixture(),gallery=await capturePage('templates',f.app,f.wx);gallery.onLoad();gallery.onShow();await tick();await gallery.category(event({id:'video'}));
 gallery.chooseTemplate(event({id:'qingjian-hot-video'}));assert.match(gallery.data.prompt,/新闻/);assert.equal(f.state.jobs.length,0);assert.equal(f.app.pendingTemplate,undefined);gallery.onHide();
});

test('resource menu keeps operations available and drops a choice after switching sections', async () => {
  const f = fixture(); f.state.media = [{ id: 'm', kind: 'video', name: '片段', createdAt: '2026-11-15', url: '' }];
  let sheet: any; f.wx.showActionSheet = (options: any) => { sheet = options; };
  const page = await capturePage('library', f.app, f.wx); page.onLoad(); page.onShow();
  assert.equal(page.data.kindCounts.video, 1);
  const pending = page.itemMenu(event({ id: 'm' })); assert.deepEqual(Array.from(sheet.itemList), ['预览', '重命名', '用来创作', '拉片分析', '删除素材', '素材整理 / MV设置']);assert.ok(sheet.itemList.length<=6);
  page.section(event({ section: 'films' })); sheet.success({ tapIndex: 1 }); await pending; assert.equal(f.app.pendingAttachments, undefined);
  page.section(event({ section: 'materials' })); const choice = page.itemMenu(event({ id: 'm' })); sheet.success({ tapIndex: 2 }); await choice;
  assert.deepEqual(Array.from(f.app.pendingAttachments), ['m']);
  const folders=page.itemMenu(event({id:'m'}));sheet.success({tapIndex:5});await tick();assert.ok(sheet.itemList.includes('移入文件夹'));sheet.success({tapIndex:0});await folders;assert.equal(page.data.pickingFolder,true);assert.deepEqual(Array.from(page.data.selectedIds),['m']);page.onHide();
});
