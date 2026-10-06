import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { startCreditServer } from './fixtures/creditServer';
import type { AppState } from '../shared/types';

test('full service admits a multi-turn job, completes with a negative balance and blocks all new model entry points', async t => {
  const f = await startCreditServer(); t.after(f.close);
  const cookie = await f.login(), initial = await (await f.request(cookie, '/api/state')).json() as AppState;
  const health = await (await f.request(cookie, '/api/health')).json() as any;
  assert.deepEqual(health.credits, { ready: true, initialSpecialAccountApplied: true });
  assert.equal(initial.credits?.balance, 2000);
  f.providerState.outputTokens = 80000; f.providerState.multiTurn = true;
  const accepted = await f.request(cookie, '/api/chat', { sessionId: initial.activeSessionId, message: '用一句话介绍功能' });
  assert.equal(accepted.status, 200);
  const submitted = await accepted.json() as AppState, jobId = submitted.jobs.at(-1)!.id;
  let current = submitted;
  for (let n = 0; n < 100 && ['queued', 'running'].includes(current.jobs.find(j => j.id === jobId)!.status); n++) {
    await new Promise(r => setTimeout(r, 40)); current = await (await f.request(cookie, '/api/state')).json() as AppState;
  }
  assert.equal(current.jobs.find(j => j.id === jobId)!.status, 'succeeded', JSON.stringify({ job: current.jobs.find(j => j.id === jobId), calls: f.providerState.calls }));
  assert.equal(current.credits!.balance, -2807.2); assert.equal(f.providerState.calls, 2);
  assert.equal(current.sessions.find(s => s.id === current.activeSessionId)!.messages.at(-1)!.text, '测试任务已完成。');
  const cases = [
    ['/api/chat', { sessionId: current.activeSessionId, message: '再做一个任务' }],
    ['/api/jobs/failed-job/retry', {}],
    ['/api/media/video-fixture/analyze', { sessionId: current.activeSessionId }],
    ['/api/avatars/avatar-fixture/generate', { sessionId: current.activeSessionId }],
  ] as const;
  for (const [route, body] of cases) {
    const response = await f.request(cookie, route, body); assert.equal(response.status, 402, route);
    const result = await response.json() as any; assert.equal(result.code, 'INSUFFICIENT_CREDITS'); assert.match(result.error, /积分不足/);
  }
  const stop = await f.request(cookie, '/api/sessions/' + current.activeSessionId + '/stop', {}); assert.equal(stop.status, 200);
  const final = await (await f.request(cookie, '/api/state')).json() as AppState;
  assert.equal(final.jobs.length, current.jobs.length); assert.equal(final.sessions.find(s => s.id === final.activeSessionId)!.messages.length, current.sessions.find(s => s.id === current.activeSessionId)!.messages.length);
  assert.equal(f.providerState.calls, 2);
  const specialCookie = await f.login('shikanon@example.test');
  const special = await (await f.request(specialCookie, '/api/state')).json() as AppState;
  assert.equal(special.credits?.special, true); assert.equal(special.credits?.balance, 1000000);
  assert.equal((await f.request(specialCookie, '/api/jobs/' + jobId + '/retry', {})).status, 404);
});
test('real registration persists 2000 before returning, failed registration grants nothing, and check-in adds 1000 only on claim', async t => {
  const f = await startCreditServer(); t.after(f.close);
  const body = { email: f.registrationEmail, displayName: '新创作者', password: f.password, verificationCode: f.verificationCode };
  assert.equal((await f.request('', '/api/auth/register', { ...body, verificationCode: '654321' })).status, 400);
  const before = JSON.parse(await readFile(path.join(f.directory, 'credits.json'), 'utf8'));
  assert.equal(Object.keys(before.wallets).length, 2); assert.equal(before.entries.length, 3);
  const beforeAuth = JSON.parse(await readFile(path.join(f.directory, 'auth.json'), 'utf8'));
  assert.equal(beforeAuth.users.some((u: any) => u.email === f.registrationEmail), false);
  const response = await f.request('', '/api/auth/register', body);
  assert.equal(response.status, 201);
  const registration = await response.json() as any;
  assert.equal(registration.credits.balance, 2000); assert.equal(registration.credits.canCheckIn, true);
  const cookie = response.headers.get('set-cookie')!.split(';')[0];
  const saved = JSON.parse(await readFile(path.join(f.directory, 'credits.json'), 'utf8'));
  assert.equal(saved.wallets[registration.user.id].balanceMicros, 2_000_000_000);
  const state = await (await f.request(cookie, '/api/state')).json() as AppState;
  assert.equal(state.credits?.balance, 2000);
  const history = await (await f.request(cookie, '/api/credits')).json() as any;
  assert.equal(history.total, 1); assert.equal(history.entries[0].kind, 'signup_grant');
  const checkInBody = { date: state.credits!.checkInDate };
  const claim = await f.request(cookie, '/api/credits/check-in', checkInBody);
  assert.equal(claim.status, 200); const claimed = await claim.json() as any;
  assert.equal(claimed.claimed, true); assert.equal(claimed.wallet.balance, 3000);
  const retry = await (await f.request(cookie, '/api/credits/check-in', checkInBody)).json() as any;
  assert.equal(retry.claimed, false); assert.equal(retry.points, 0); assert.equal(retry.wallet.balance, 3000);
  assert.equal((await f.request('', '/api/auth/register', body)).status, 409);
  const reloginCookie = await f.login(f.registrationEmail);
  const final = await (await f.request(reloginCookie, '/api/credits')).json() as any;
  assert.equal(final.wallet.balance, 3000); assert.equal(final.total, 2);
  assert.equal(final.entries.every((e: any) => e.userId === registration.user.id), true);
  assert.equal(f.providerState.calls, 0, 'claiming points never invokes a model');
  const ordinaryCookie = await f.login();
  assert.equal((await (await f.request(ordinaryCookie, '/api/credits')).json() as any).wallet.balance, 2000);
  const crossOrigin = await fetch(f.base + '/api/credits/check-in', { method: 'POST', headers: { Cookie: ordinaryCookie, Origin: 'https://untrusted.example', 'Content-Type': 'application/json' }, body: JSON.stringify(checkInBody) });
  assert.equal(crossOrigin.status, 403);
  assert.equal((await (await f.request(ordinaryCookie, '/api/credits')).json() as any).wallet.balance, 2000);
});
