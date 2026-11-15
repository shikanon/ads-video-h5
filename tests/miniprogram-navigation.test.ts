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

test('template tab carries selection once into a cached chat draft without replacing text or attachments', async () => {
  const f = fixture();
  f.state.media = [{ id: 'attachment', name: '素材', kind: 'video' }];
  const chat = await capturePage('chat', f.app, f.wx);
  chat.onLoad(); chat.onShow();
  chat.setData({ prompt: '保留文字', attachmentIds: ['attachment'], cursor: 4 });
  chat.openTemplates(); chat.onHide();
  const gallery = await capturePage('templates', f.app, f.wx);
  gallery.onShow(); await tick();
  assert.equal(gallery.data.cards[0].skill, true);
  gallery.use(event({ id: template().id }));
  gallery.use(event({ id: template().id }));
  assert.equal(f.calls.filter(call => call.url === '/pages/chat/index').length, 1);
  gallery.onHide(); chat.onShow();
  assert.equal(chat.data.prompt, '@界面动效 保留文字');
  assert.deepEqual(Array.from(chat.data.attachmentIds), ['attachment']);
  assert.equal(chat.data.templateName, '界面动效');
  assert.equal(f.app.pendingTemplate, null);
  chat.onShow(); assert.equal(chat.data.prompt, '@界面动效 保留文字');
  gallery.onShow(); await tick();
  assert.equal(gallery.data.returning, false, 'cached tab can be used again');
  gallery.onHide(); chat.onUnload();
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

test('catalog refresh preserves cards on failure and ignores stale account responses; guests remain on the template tab', async () => {
  const f = fixture(), gallery = await capturePage('templates', f.app, f.wx);
  gallery.onShow(); await tick();
  gallery.preview(event({ id: template().id })); assert.equal(gallery.data.preview.id, template().id, 'a skill without sample has details');
  gallery.closePreview(); gallery.filter('产品', 'skills'); assert.equal(gallery.data.cards.length, 1);
  f.app.client.request = async () => { throw new Error('离线'); };
  await gallery.load(); assert.equal(gallery.data.cards.length, 1); assert.equal(gallery.data.error, '离线');
  let finish: any;
  f.app.client.request = () => new Promise(resolve => { finish = resolve; });
  const pending = gallery.load();
  f.app._generation++; f.app.client.hasSession = () => false;
  gallery.onHide(); gallery.onShow();
  finish({ templates: [template('old-account')] }); await pending;
  assert.equal(gallery.data.cards.length, 0); assert.equal(gallery.data.guest, true);
  assert.equal(f.calls.length, 0, 'opening a guest tab never forces authentication');
  gallery.onHide();
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

test('skill catalog groups actual capabilities and news starter preserves the draft without sending', async () => {
  const f = fixture();
  f.state.templates = [template('animated-science-video'), template('video-style-pixel'), { ...template('qingmao-stickers'), output: 'sticker-pack' }];
  const gallery = await capturePage('templates', f.app, f.wx); gallery.onShow(); await tick();
  assert.deepEqual(Array.from(gallery.data.categories, (c: any) => c.id), ['all', 'game', 'stickers', 'static-stickers', 'knowledge', 'news', 'editing']);
  gallery.chooseFilter(event({ category: 'news' })); assert.equal(gallery.data.cards.length, 1); assert.equal(gallery.data.cards[0].id, 'qingjian-hot-video');
  const chat = await capturePage('chat', f.app, f.wx); chat.onLoad(); chat.onShow(); chat.setData({ prompt: '人工智能', attachmentIds: [] }); chat.onHide();
  gallery.use(event({ id: 'qingjian-hot-video' })); gallery.onHide(); chat.onShow();
  assert.equal(chat.data.prompt, '制作一个新闻资讯视频，主题：人工智能'); chat.setData({ mode: 'chat' }); assert.equal(chat.interaction(), 'create'); assert.equal(f.state.jobs.length, 0); chat.onUnload();
});

test('resource menu keeps operations available and drops a choice after switching sections', async () => {
  const f = fixture(); f.state.media = [{ id: 'm', kind: 'video', name: '片段', createdAt: '2026-11-15', url: '' }];
  let sheet: any; f.wx.showActionSheet = (options: any) => { sheet = options; };
  const page = await capturePage('library', f.app, f.wx); page.onLoad(); page.onShow();
  assert.equal(page.data.kindCounts.video, 1);
  const pending = page.itemMenu(event({ id: 'm' })); assert.deepEqual(Array.from(sheet.itemList), ['预览', '用来创作', '拉片分析', '删除素材']);
  page.section(event({ section: 'films' })); sheet.success({ tapIndex: 1 }); await pending; assert.equal(f.app.pendingAttachments, undefined);
  page.section(event({ section: 'materials' })); const choice = page.itemMenu(event({ id: 'm' })); sheet.success({ tapIndex: 1 }); await choice;
  assert.deepEqual(Array.from(f.app.pendingAttachments), ['m']); page.onHide();
});
