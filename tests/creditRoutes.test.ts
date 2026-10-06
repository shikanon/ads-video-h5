import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createAdminAuth } from '../server/adminAuth';
import { createCredits } from '../server/credits';
import { mountCreditAdminRoutes, mountCreditRoutes } from '../server/creditRoutes';
import { mountVoiceInputRoutes } from '../server/voiceInput';
import { defaultTokenPrices } from '../server/tokenPricing';
import { jobFetch } from '../server/jobExecution';

const users = [{ id: 'a', email: 'a@example.test', displayName: '用户甲' }, { id: 'b', email: 'b@example.test', displayName: '用户乙' }];
async function fixture(t: any) {
  const directory = await mkdtemp(path.join(tmpdir(), 'qj-credit-routes-'));
  const credits = createCredits(directory); await credits.load(users);
  const admin = createAdminAuth(directory, { initialPassword: 'QA-admin-password-123' }); await admin.load();
  const app = express(); app.use(express.json()); admin.mount(app);
  mountCreditAdminRoutes(app, credits, admin, () => users);
  app.use((request, response, next) => {
    const user = users.find(u => u.id === request.get('x-test-owner'));
    if (!user) return response.status(401).json({ error: 'login required' });
    Object.assign(request, { user }); next();
  });
  mountCreditRoutes(app, credits);
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); await rm(directory, { recursive: true, force: true }); });
  const request = (route: string, body?: unknown, token?: string, method = body ? 'POST' : 'GET') => fetch(base + route, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const login = await (await request('/api/admin/auth/login', { username: 'admin', password: 'QA-admin-password-123' })).json() as any;
  const ready = await (await request('/api/admin/auth/password', { password: 'QA-admin-password-123', newPassword: 'QA-admin-personal-456' }, login.token, 'PUT')).json() as any;
  return { app, base, credits, request, token: ready.token };
}
test('credit management requires independent admin authentication, existing users and valid prices', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/api/admin/credits')).status, 401);
  assert.equal((await fetch(f.base + '/api/admin/credits', { headers: { 'x-test-owner': 'a', Cookie: 'qingjian_session=ordinary' } })).status, 401);
  const state = await (await f.request('/api/admin/credits', undefined, f.token)).json() as any;
  assert.equal(state.accounts.length, 2); assert.equal(state.accounts[0].wallet.balance, 1000);
  assert.equal((await f.request('/api/admin/credits/users/absent', { special: true }, f.token, 'PATCH')).status, 404);
  assert.equal((await f.request('/api/admin/credits/users/a', { special: 'yes' }, f.token, 'PATCH')).status, 400);
  const special = await (await f.request('/api/admin/credits/users/a', { special: true }, f.token, 'PATCH')).json() as any;
  assert.equal(special.wallet.balance, 1000000);
  const model = defaultTokenPrices()[0];
  assert.equal((await f.request('/api/admin/credits/prices/' + model.modelId, { ...model, input: -1 }, f.token, 'PUT')).status, 400);
  assert.equal((await f.request('/api/admin/credits/prices/' + model.modelId, { ...model, output: 10 }, f.token, 'PUT')).status, 200);
  const history = await (await f.request('/api/admin/credits/users/a/ledger', undefined, f.token)).json() as any;
  assert.equal(history.total, 2); assert.equal(history.entries[0].kind, 'special_grant');
});
test('ordinary credit history is authenticated and cannot select another owner through query parameters', async t => {
  const f = await fixture(t); await f.credits.setSpecial('b', true);
  assert.equal((await fetch(f.base + '/api/credits')).status, 401);
  const result = await (await fetch(f.base + '/api/credits?userId=b&limit=9999&offset=-10', { headers: { 'x-test-owner': 'a' } })).json() as any;
  assert.equal(result.wallet.balance, 1000); assert.equal(result.entries.every((e: any) => e.userId === 'a'), true);
  assert.ok(!JSON.stringify(result).includes('用户乙'));
});
test('voice route charges under the user context and preserves the full prefixed instruction after exhausting credits', async t => {
  const f = await fixture(t), original = globalThis.fetch, model = defaultTokenPrices()[3]; let calls = 0;
  globalThis.fetch = async (input, init) => {
    if (String(input).startsWith(f.base)) return original(input, init);
    calls++;
    return new Response(JSON.stringify({ id: 'voice-' + calls, usage: { prompt_tokens: 100000, completion_tokens: 0, prompt_tokens_details: { audio_tokens: 100000, cached_tokens: 0, audio_cached_tokens: 0 } } }));
  };
  t.after(() => { globalThis.fetch = original; });
  mountVoiceInputRoutes(f.app, tmpdir(), async () => {
    await (await jobFetch('https://provider.test/chat/completions', { method: 'POST', body: JSON.stringify({ model: model.modelId, messages: [{ content: [{ type: 'input_audio' }] }] }) })).json();
    return { text: '介绍今天的大模型新闻', duration: 2 };
  }, f.credits);
  const upload = () => { const form = new FormData(); form.append('prefix', '制作口播视频'); form.append('audio', new Blob(['fixture'], { type: 'audio/webm' }), 'voice.webm'); return form; };
  const first = await fetch(f.base + '/api/voice/transcribe', { method: 'POST', headers: { 'x-test-owner': 'a' }, body: upload() });
  assert.equal(first.status, 200); const result = await first.json() as any;
  assert.equal((await f.credits.snapshot('a')).balance, -200); assert.equal(calls, 1);
  const combined = '制作口播视频\n介绍今天的大模型新闻';
  const taskId = await f.credits.admit('a', combined, result.creditTicket);
  assert.equal(taskId, (await f.credits.history('a')).entries[0].taskId);
  const second = await fetch(f.base + '/api/voice/transcribe', { method: 'POST', headers: { 'x-test-owner': 'a' }, body: upload() });
  assert.equal(second.status, 402); assert.equal((await second.json() as any).code, 'INSUFFICIENT_CREDITS'); assert.equal(calls, 1);
});
