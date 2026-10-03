import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { once } from 'node:events';
import { runInNewContext } from 'node:vm';
import { mountFrontendRoutes } from '../server/frontendRoutes';
import { effectPreview } from '../server/effectPreview';
import { createEffectStore } from '../server/htmlEffects';

test('independent admin routes serve their own entry and assets with canonical public URLs', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'qj-admin-routes-'));
  const app = express();
  await mkdir(path.join(directory, 'admin/assets'), { recursive: true });
  await writeFile(path.join(directory, 'index.html'), '<title>手机轻剪</title>');
  await writeFile(path.join(directory, 'admin/index.html'), '<title>管理控制台</title>');
  await writeFile(path.join(directory, 'admin/assets/admin.js'), 'window.admin=true;');
  mountFrontendRoutes(app, directory, '/qingjian');
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const redirect = await fetch(`${base}/admin?tab=effects`, { redirect: 'manual' });
    assert.equal(redirect.status, 308); assert.equal(redirect.headers.get('location'), '/qingjian/admin/?tab=effects');
    assert.match(await (await fetch(`${base}/`)).text(), /手机轻剪/);
    assert.match(await (await fetch(`${base}/admin/`)).text(), /管理控制台/);
    assert.match(await (await fetch(`${base}/admin/history`)).text(), /管理控制台/);
    assert.equal(await (await fetch(`${base}/admin/assets/admin.js`)).text(), 'window.admin=true;');
    assert.equal((await fetch(`${base}/admin/assets/missing.js`)).status, 404);
    assert.equal((await fetch(`${base}/admin/missing.css`)).status, 404);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); await rm(directory, { recursive: true, force: true }); }
});

test('an unbuilt admin cannot accidentally display the mobile frontend', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'qj-admin-missing-'));
  await writeFile(path.join(directory, 'index.html'), '<title>手机轻剪</title>');
  const app = express(); mountFrontendRoutes(app, directory);
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const response = await fetch(`http://127.0.0.1:${(server.address() as { port: number }).port}/admin/`);
    assert.equal(response.status, 404); assert.match(await response.text(), /尚未构建/);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); await rm(directory, { recursive: true, force: true }); }
});

test('preview controls reject foreign messages, clamp seeking, loop and pause deterministically', () => {
  const document = effectPreview('<html><head></head><body>画面</body></html>', 6);
  const code = document.html.match(/<script>([\s\S]*)<\/script>/)![1];
  const commands: number[] = [], messages: any[] = [], listeners: Record<string, (event: any) => void> = {};
  let frame: ((time: number) => void) | undefined;
  const parent = { postMessage: (value: unknown) => messages.push(value) };
  const timeline = { pause: () => {}, seek: (time: number) => commands.push(time) };
  const mediaSeeks: number[] = [];
  let mediaTime = 0;
  const video = { readyState: 1, duration: 4, autoplay: true, paused: false, get currentTime() { return mediaTime; }, set currentTime(value: number) { mediaTime = value; mediaSeeks.push(value); }, pause() { this.paused = true; }, play() { this.paused = false; return Promise.resolve(); }, addEventListener: () => {} };
  runInNewContext(code, {
    window: { __timelines: { main: timeline }, addEventListener: (event: string, listener: (event: any) => void) => { listeners[event] = listener; } },
    document: { querySelectorAll: () => [video], addEventListener: () => {} }, parent,
    requestAnimationFrame: (callback: (time: number) => void) => { frame = callback; return 1; }, cancelAnimationFrame: () => { frame = undefined; },
  });
  const send = (action: string, time?: number, previewId = document.previewId, source: unknown = parent) => listeners.message({ source, data: { type: 'qingjian:effect:control', previewId, action, time } });
  assert.equal(messages[0].type, 'qingjian:effect:ready');
  send('seek', 3, 'foreign-id'); send('seek', 3, document.previewId, {}); assert.deepEqual(commands, [0]);
  send('seek', 99); assert.equal(commands.at(-1), 6); send('seek', -1); assert.equal(commands.at(-1), 0);
  send('play'); const seekCount = mediaSeeks.length; frame!(1000); frame!(1200); assert.equal(mediaSeeks.length, seekCount, 'continuous video playback must not seek at every display frame'); assert.equal(video.paused, false);
  frame!(8100); assert.ok(Math.abs(commands.at(-1)! - 1.1) < .001); assert.ok(Math.abs(video.currentTime - 1.1) < .001);
  send('pause'); assert.equal(frame, undefined); assert.equal(messages.at(-1).playing, false); assert.equal(video.paused, true);
  assert.match(document.html, /connect-src 'none'/); assert.match(document.html, /base-uri 'none'/);
  assert.throws(() => effectPreview('', Number.NaN), /预览时长/);
});

test('previews use the saved HTML animation and validate composition inputs before interpolation', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'qj-admin-preview-'));
  try {
    const store = createEffectStore(directory); await store.init();
    for (const effect of store.list()) {
      const compiled = await store.compile(effect, { title: '<script>示例</script>' }, true);
      const preview = effectPreview(compiled, effect.duration);
      assert.ok(preview.html.includes('window.__timelines["main"]'));
      assert.ok(preview.html.includes('QJMotion'));
      assert.ok(preview.html.includes('Content-Security-Policy'));
      assert.ok(!preview.html.includes('"title":"<script>'));
      assert.notEqual(effectPreview(compiled, effect.duration).previewId, preview.previewId);
    }
    const effect = store.list()[0];
    await assert.rejects(store.compile({ ...effect, width: '1080;alert(1)' as any }, {}, true), /画幅/);
    await assert.rejects(store.compile({ ...effect, duration: '1;alert(1)' as any }, {}, true), /时长/);
    assert.ok(!(await store.compile(effect, {}, false)).includes('qingjian:effect:control'));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
