import test from 'node:test';
import assert from 'node:assert/strict';
import { capturePage, recorderFixture, miniRequire } from './fixtures/nativeClient';

const event = (dataset: Record<string, string>) => ({ currentTarget: { dataset } });

async function fixture(mode = 'work') {
  const calls: any[] = [];
  const state: any = {
    activeSessionId: 'work', sessions: [{ id: 'work', mode, messages: [] }],
    media: [], artifacts: [], jobs: [], templates: [{ id: 'animated-science-video', name: '动态图解', output: 'video' }],
  };
  const app: any = {
    _generation: 1, state, subscribe: () => () => {}, refresh: async () => state,
    commit(next: any) { app.state = next; },
    client: { hasSession: () => true, previewUrl: () => '' },
    async mutate(route: string, request: any) { calls.push({ route, request }); return state; },
  };
  const platform = {
    getRecorderManager: recorderFixture, showToast() {}, hideKeyboard() {},
    showModal(options: any) { options.success({ confirm: true }); },
  };
  const page = await capturePage('chat', app, platform);
  page.onLoad();
  page.onShow();
  return { app, state, page, calls };
}

test('the chat hint fills an editable draft and sends the template only when Send is pressed', async () => {
  const { page, calls } = await fixture('chat');
  const previous = page.data.workHint.id;
  page.rotateWorkHint();
  assert.notEqual(page.data.workHint.id, previous);
  const entry = miniRequire('./miniprogram/pages/chat/work-entry');
  page.setData({ workHint: entry.suggestions.find((item: any) => item.id === 'explain'), prompt: '保留草稿' });
  page.acceptWorkHint();
  assert.equal(page.data.prompt, '保留草稿');
  assert.equal(calls.length, 0);
  page.setData({ prompt: '' });
  page.acceptWorkHint();
  assert.equal(page.data.prompt, '用 45 秒讲明白什么是大模型');
  assert.equal(page.data.focus, false);
  assert.equal(calls.length, 0);
  await page.send();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].route, '/api/chat');
  assert.equal(calls[0].request.interaction, 'create');
  assert.match(calls[0].request.message, /^@animated-science-video /);
  assert.equal(page.data.prompt, '');
  page.onUnload();
});

test('quick suggestions rotate one of three unique entries and still fill the draft when tapped', async () => {
  const { page, calls } = await fixture('chat');
  const ids = () => Array.from(page.data.visibleSuggestions, (item: any) => item.id);
  let before = ids();
  assert.equal(new Set(before).size, 3);
  for (let i = 0; i < 10; i++) {
    page.rotateSuggestions();
    const next = ids();
    assert.equal(new Set(next).size, 3);
    assert.equal(next.filter((id, index) => id !== before[index]).length, 1);
    assert.equal(next.filter(id => !before.includes(id)).length, 1);
    before = next;
  }
  page.setData({ keyboardHeight: 240 });
  page.rotateSuggestions();
  assert.deepEqual(ids(), before);
  page.setData({ keyboardHeight: 0 });
  await page.selectWorkStarter(event({ id: before[0] as string }));
  assert.ok(page.data.prompt);
  assert.equal(calls.length, 0);
  page.onHide();
  assert.equal(page._suggestionTimer, null);
  page.rotateSuggestions();
  assert.deepEqual(ids(), before);
  page.onUnload();
});

test('work mode has no inline hint but its sidebar can open the skill picker', async () => {
  const { page, calls } = await fixture();
  page.acceptWorkHint();
  await page.showWorkTemplates();
  assert.equal(page.data.prompt, '');
  assert.equal(page.data.workCatalogOpen, true);
  assert.equal(page.data.mode, 'work');
  page.closeWorkTemplates();
  page.setData({ mode: 'chat' });
  page.editInsteadOfHint();
  assert.equal(page.data.focus, true);
  assert.equal(page.data.prompt, '');
  assert.equal(calls.length, 0);
  page.onUnload();
});

test('a skill chosen from work fills the chat draft and keeps the work draft', async () => {
  const { app, state, page, calls } = await fixture();
  state.features = { conversationModes: true };
  state.sessions.push({ id: 'chat', mode: 'chat', messages: [] });
  page._drafts.chat = { prompt: '对话主题', cursor: 4, attachmentIds: [] };
  page.setData({ prompt: '保留我的工作草稿', cursor: 8, sidebarOpen: true });
  await page.showWorkTemplates();
  assert.equal(page.data.sessionId, 'work');
  assert.equal(calls.length, 0);
  await page.selectWorkStarter(event({ id: 'science' }));
  assert.equal(page.data.mode, 'chat');
  assert.equal(page.data.sessionId, 'chat');
  assert.equal(page.data.prompt, '@知识科普动态图视频 对话主题');
  assert.equal(page._drafts.work.prompt, '保留我的工作草稿');
  assert.equal(page.data.workCatalogOpen, false);
  assert.deepEqual(calls.map(call => call.route), ['/api/sessions/chat/activate']);
  assert.equal(app.state.sessions.find((session: any) => session.id === 'work').mode, 'work');
  page.onUnload();
});

test('choosing a skill without a chat draft creates a separate chat and preserves the empty work session', async () => {
  const { app, state, page } = await fixture();
  state.features = { conversationModes: true };
  let creations = 0;
  app.mutate = async (route: string, request: any) => {
    assert.equal(route, '/api/sessions');
    assert.equal(request.mode, 'chat');
    assert.equal(request.reuseEmpty, false);
    creations++;
    return { ...state, activeSessionId: 'new-chat', sessions: [...state.sessions, { id: 'new-chat', mode: 'chat', messages: [] }] };
  };
  await page.showWorkTemplates();
  assert.equal(creations, 0);
  await page.selectWorkStarter(event({ id: 'science' }));
  assert.equal(creations, 1);
  assert.equal(page.data.sessionId, 'new-chat');
  assert.equal(page.data.prompt, '@知识科普动态图视频 ');
  assert.equal(app.state.sessions.find((session: any) => session.id === 'work').mode, 'work');
  page.onUnload();
});

test('the skill picker offers bundled skills before state sync and folds in the published catalog once', async () => {
  const { app, page, calls } = await fixture('chat');
  app.state = null;
  app.client.hasSession = () => false;
  let requests = 0, respond!: (value: unknown) => void;
  app.client.request = (route: string) => {
    assert.equal(route, '/api/templates');
    requests++;
    return new Promise(resolve => { respond = resolve; });
  };
  page.setData({ sidebarOpen: true, prompt: '保留的主题' });
  const loading = page.showWorkTemplates();
  assert.equal(page.data.sidebarOpen, false);
  const names = () => Array.from(page.data.workCatalog, (item: any) => item.name);
  assert.ok(names().includes('界面动效'));
  assert.ok(names().includes('热点新闻'));
  assert.ok(names().includes('新角色静态表情'));
  assert.ok(names().length > 3);
  await page.showWorkTemplates();
  assert.equal(requests, 1);
  respond({ templates: [
    { id: 'defold-game', name: 'Defold游戏' },
    { id: 'defold-game', name: 'Defold游戏' },
    { id: 'animated-science-video', name: '动态图科普视频' },
  ] });
  await loading;
  assert.equal(names().filter(name => name === 'Defold游戏').length, 1);
  assert.equal(names().includes('动态图科普视频'), false);
  page.selectWorkStarter(event({ id: 'qingjian-hot-video' }));
  assert.equal(page.data.prompt, '制作一个新闻资讯视频，主题：保留的主题');
  page.selectWorkStarter(event({ id: 'defold-game' }));
  assert.equal(page.data.prompt, '@defold-game 保留的主题');
  assert.equal(page.data.templateName, 'Defold游戏');
  assert.equal(page.data.workCatalogOpen, false);
  assert.equal(calls.length, 0);
  page.onUnload();
});

test('the skill picker keeps bundled entries and can retry if its catalog request fails', async () => {
  const { app, page } = await fixture('chat');
  app.state.templates = [];
  let requests = 0;
  app.client.request = async () => {
    if (++requests === 1) throw Error('离线');
    return { templates: [{ id: 'video-style-pixel', name: '像素游戏' }] };
  };
  await page.showWorkTemplates();
  assert.ok(page.data.workCatalog.some((item: any) => item.id === 'video-style-interface'));
  page.closeWorkTemplates();
  await page.showWorkTemplates();
  assert.equal(requests, 2);
  assert.ok(page.data.workCatalog.some((item: any) => item.id === 'video-style-pixel'));
  page.onUnload();
});

test('sticker initiation stays in the conversation and retries an uncertain submission with the same ID', async () => {
  const { app, state, page, calls } = await fixture();
  state.media = [{ id: 'reference', name: '参考图', kind: 'image' }];
  page.setData({ attachmentIds: ['reference'] });
  page.selectWorkStarter(event({ id: 'sticker' }));
  await page.send();
  assert.equal(page.data.workPanel.type, 'sticker');
  assert.equal(calls.length, 0);
  app.client.request = async (route: string, body: any) => {
    if (route.endsWith('/config')) return { available: true, pricing: { styleCandidates: 6, pricingHash: 'price' } };
    calls.push({ route, body });
    if (calls.length === 1) throw Error('响应丢失');
    return { state };
  };
  await page.startWorkSticker();
  assert.equal(page.data.error, '响应丢失');
  await page.startWorkSticker();
  assert.equal(calls[1].body.requestId, calls[0].body.requestId);
  assert.equal(calls[1].body.sessionId, 'work');
  assert.equal(calls[1].body.recipe.referenceMediaId, 'reference');
  assert.equal(calls[1].body.recipe.mode, 'dynamic');
  assert.equal(page.data.workPanel, null);
  page.onUnload();
});

test('batch submission opens the batch from the existing server snapshot and keeps its item status', async () => {
  const { app, state, page } = await fixture();
  page.setData({ prompt: '批量制作：力和运动\n日食' });
  await page.send();
  assert.equal(page.data.workPanel.type, 'batch');
  app.client.request = async (route: string, body: any) => {
    assert.equal(route, '/api/tool-batches');
    assert.equal(body.topics.join(','), '力和运动,日食');
    const items = body.topics.map((topic: string, index: number) => ({ topic, index, status: 'queued' }));
    return { state: { ...state, toolBatches: [{ id: 'batch', name: body.name, templateId: body.templateId, done: 0, count: 2, items }] } };
  };
  await page.startWorkBatch();
  assert.equal(page.data.workBatchId, 'batch');
  assert.equal(page.data.workBatch.items[0].statusLabel, '排队中');
  assert.equal(page.data.workPanel, null);
  page.onUnload();
});

test('private videos preview inline and an old account cannot restore a completed playback request', async () => {
  const { app, state, page } = await fixture();
  state.artifacts = [{ id: 'video', name: '示例成片', kind: 'video', url: '/api/artifacts/video' }];
  app.client.mediaUrl = (url: string) => 'https://example.test' + url;
  app.client.request = async (route: string, input: any) => {
    assert.equal(route, '/api/media-playback');
    assert.equal(input.id, 'video');
    return { url: '/temporary-playback' };
  };
  await page.previewWorkArtifact(event({ id: 'video' }));
  assert.equal(page.data.workPreview.kind, 'video');
  assert.equal(page.data.workPreview.path, 'https://example.test/temporary-playback');
  page.closeWorkPreview();
  let resolve!: (value: any) => void;
  app.client.request = () => new Promise(accept => { resolve = accept; });
  const pending = page.previewWorkArtifact(event({ id: 'video' }));
  app._generation++;
  page.render({ ...state, artifacts: [] });
  resolve({ url: '/old-account-playback' });
  await pending;
  assert.equal(page.data.workPreview, null);
  page.onUnload();
});
