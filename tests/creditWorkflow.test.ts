import test from 'node:test';
import assert from 'node:assert/strict';
import { startCreditServer } from './fixtures/creditServer';
import type { AppState } from '../shared/types';

test('full service admits a multi-turn job, completes with a negative balance and blocks all new model entry points', async t => {
  const f = await startCreditServer(); t.after(f.close);
  const cookie = await f.login(), initial = await (await f.request(cookie, '/api/state')).json() as AppState;
  assert.equal(initial.credits?.balance, 1000);
  f.providerState.outputTokens = 40000; f.providerState.multiTurn = true;
  const accepted = await f.request(cookie, '/api/chat', { sessionId: initial.activeSessionId, message: '用一句话介绍功能' });
  assert.equal(accepted.status, 200);
  const submitted = await accepted.json() as AppState, jobId = submitted.jobs.at(-1)!.id;
  let current = submitted;
  for (let n = 0; n < 100 && ['queued', 'running'].includes(current.jobs.find(j => j.id === jobId)!.status); n++) {
    await new Promise(r => setTimeout(r, 40)); current = await (await f.request(cookie, '/api/state')).json() as AppState;
  }
  assert.equal(current.jobs.find(j => j.id === jobId)!.status, 'succeeded', JSON.stringify({ job: current.jobs.find(j => j.id === jobId), calls: f.providerState.calls }));
  assert.equal(current.credits!.balance, -1407.2); assert.equal(f.providerState.calls, 2);
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
