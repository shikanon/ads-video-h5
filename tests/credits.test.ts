import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Type } from 'typebox';
import { createCredits, CreditError } from '../server/credits';
import { defaultTokenPrices, tokenUsage, tokenCostMicros, validateTokenPrice, POINT_MICROS } from '../server/tokenPricing';
import { withCreditUsage, creditFetch } from '../server/creditUsage';
import { jobFetch } from '../server/jobExecution';
import { getAgent } from '../server/core';

const users = [{ id: 'ordinary', email: 'ordinary@example.test', displayName: '普通用户' }, { id: 'special', email: 'shikanon@example.test', displayName: 'shikanon' }];
const price = defaultTokenPrices()[0];
const usage = tokenUsage({ prompt_tokens: 1000, completion_tokens: 100, prompt_tokens_details: { cached_tokens: 500 }, completion_tokens_details: { reasoning_tokens: 80 } })!;
async function fixture(t: Parameters<Parameters<typeof test>[1]>[0]) {
  const directory = await mkdtemp(path.join(tmpdir(), 'qj-credits-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let clock = Date.parse('2026-10-06T23:59:00+08:00');
  const credits = createCredits(directory, { now: () => clock }); await credits.load(users);
  return { directory, credits, now: () => clock, advance: (ms: number) => { clock += ms; } };
}
test('official online prices charge uncached, cached and output tokens exactly without counting reasoning twice', () => {
  assert.equal(tokenCostMicros(usage, price) / POINT_MICROS, 6.6);
  assert.equal(tokenCostMicros(usage, defaultTokenPrices()[1]) / POINT_MICROS, 7.35);
  assert.equal(tokenCostMicros(usage, defaultTokenPrices()[2]) / POINT_MICROS, .795);
  assert.deepEqual(tokenUsage({ input_tokens: 20, output_tokens: 3, input_tokens_details: { cached_tokens: 5 } }), { input: 20, output: 3, cachedInput: 5, audioInput: 0, cachedAudioInput: 0 });
  assert.equal(tokenCostMicros(tokenUsage({ prompt_tokens: 1, completion_tokens: 0 })!, price), 6000);
});
test('audio cache overlaps are subtracted once at the actual audio rates', () => {
  const audio = tokenUsage({ prompt_tokens: 160, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 40, audio_tokens: 100, audio_cached_tokens: 30 } })!;
  assert.equal(tokenCostMicros(audio, defaultTokenPrices()[3]), 980600);
});
test('invalid token metadata and invalid rate configuration cannot fabricate or overcharge usage', () => {
  for (const value of [{ prompt_tokens: -1, completion_tokens: 1 }, { input_tokens: 1 }, { input_tokens: 1.5, output_tokens: 2 }, { input_tokens: 1, output_tokens: 2, input_tokens_details: { cached_tokens: 2 } }, { input_tokens: 10, output_tokens: 2, input_tokens_details: { cached_tokens: 9, audio_tokens: 8, audio_cached_tokens: 0 } }]) assert.equal(tokenUsage(value), undefined);
  for (const value of [{ ...price, input: -.1 }, { ...price, cachedInput: 7 }, { ...price, output: .0001 }, { ...price, modelId: '../injected' }, { ...price, cachedAudioInput: 1 }]) assert.throws(() => validateTokenPrice(value));
  assert.throws(() => tokenCostMicros({ ...usage, audioInput: 1 }, price), /音频/);
});
test('registration grants 2000 once; reads and missed Beijing days never award points automatically', async t => {
  const f = await fixture(t);
  const initial = await f.credits.snapshot('ordinary');
  assert.equal(initial.balance, 2000); assert.equal(initial.registrationGrant, 2000);
  assert.equal(initial.canCheckIn, true); assert.equal(initial.lastCheckInDate, null);
  assert.equal(initial.checkInDate, '2026-10-06');
  assert.equal((await f.credits.history('ordinary')).entries[0].kind, 'signup_grant');
  await f.credits.recordUsage('ordinary', 'accepted', price.modelId, 'big', { ...usage, input: 0, cachedInput: 0, output: 100000 }, { ...price, output: 25 });
  assert.equal((await f.credits.snapshot('ordinary')).balance, -500);
  await assert.rejects(() => f.credits.admit('ordinary'), CreditError);
  f.advance(60000);
  assert.equal((await f.credits.history('ordinary')).wallet.balance, -500);
  await assert.rejects(() => f.credits.admit('ordinary'), CreditError);
  const claimed = await f.credits.checkIn('ordinary', '2026-10-07');
  assert.equal(claimed.claimed, true); assert.equal(claimed.points, 1000);
  assert.equal((await f.credits.snapshot('ordinary')).balance, 500);
  assert.equal((await f.credits.snapshot('ordinary')).canCheckIn, false);
  assert.equal((await f.credits.snapshot('ordinary')).nextCheckInAt, '2026-10-08T00:00:00+08:00');
  await f.credits.admit('ordinary');
  const restarted = createCredits(f.directory, { now: f.now }); await restarted.load(users);
  assert.equal((await restarted.snapshot('ordinary')).balance, 500);
  assert.equal((await restarted.checkIn('ordinary', '2026-10-07')).claimed, false);
  f.advance(3 * 86400000);
  assert.equal((await restarted.snapshot('ordinary')).balance, 500);
  assert.equal((await restarted.snapshot('ordinary')).canCheckIn, true);
  assert.equal((await restarted.checkIn('ordinary', '2026-10-10')).wallet.balance, 1500);
  assert.equal((await stat(path.join(f.directory, 'credits.json'))).mode & 0o777, 0o600);
});
test('parallel claims and a lost receipt retry award one durable daily reward per owner', async t => {
  const f = await fixture(t);
  const receipts = await Promise.all(Array.from({ length: 30 }, () => f.credits.checkIn('ordinary', '2026-10-06')));
  assert.equal(receipts.filter(r => r.claimed).length, 1);
  assert.equal(receipts.reduce((sum, r) => sum + r.points, 0), 1000);
  assert.equal((await f.credits.snapshot('ordinary')).balance, 3000);
  assert.equal((await f.credits.history('ordinary')).entries.filter(e => e.kind === 'daily_checkin').length, 1);
  assert.equal((await f.credits.snapshot('special')).canCheckIn, true);
  const restart = createCredits(f.directory, { now: f.now }); await restart.load(users);
  const retry = await restart.checkIn('ordinary', '2026-10-06');
  assert.equal(retry.claimed, false); assert.equal(retry.points, 0); assert.equal(retry.wallet.balance, 3000);
  assert.equal((await restart.checkIn('special', '2026-10-06')).wallet.balance, 1001000);
});
test('a card opened before Beijing midnight cannot claim a different day silently', async t => {
  const f = await fixture(t), cardDate = (await f.credits.snapshot('ordinary')).checkInDate;
  f.advance(60000);
  await assert.rejects(() => f.credits.checkIn('ordinary', cardDate), (error: unknown) => error instanceof CreditError && error.status === 409 && error.code === 'CHECK_IN_DAY_CHANGED');
  assert.equal((await f.credits.snapshot('ordinary')).balance, 2000);
  assert.equal((await f.credits.checkIn('ordinary', '2026-10-07')).wallet.balance, 3000);
  f.advance(86400000);
  assert.equal((await f.credits.checkIn('ordinary', '2026-10-08')).wallet.balance, 4000);
});
test('existing shikanon gets exactly one million; toggling special or registering the nickname cannot mint more', async t => {
  const f = await fixture(t);
  assert.equal((await f.credits.snapshot('special')).balance, 1000000);
  assert.deepEqual(await f.credits.readiness(), { ready: true, initialSpecialAccountApplied: true });
  await f.credits.recordUsage('special', 'accepted', price.modelId, 'one', usage, price);
  await f.credits.setSpecial('special', false); await f.credits.setSpecial('special', true);
  assert.equal((await f.credits.snapshot('special')).balance, 999993.4);
  await f.credits.setSpecial('ordinary', true);
  assert.equal((await f.credits.snapshot('ordinary')).balance, 1000000);
  const restarted = createCredits(f.directory, { now: f.now }); await restarted.load([...users, { id: 'impersonator', displayName: 'shikanon', email: 'another@example.test' }]);
  assert.equal((await restarted.readiness()).initialSpecialAccountApplied, true, 'the uniquely matched email account remains the target');
  assert.equal((await restarted.snapshot('impersonator')).balance, 2000);
  assert.equal((await restarted.snapshot('special')).balance, 999993.4);
});
test('bootstrap receipt does not misidentify ambiguous names or grant a later same-name registration', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'qj-credit-bootstrap-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const credits = createCredits(directory); await credits.load([{ ...users[0], displayName: 'shikanon' }, { ...users[1], email: 'b@example.test' }]);
  assert.deepEqual(await credits.readiness(), { ready: true, initialSpecialAccountApplied: false });
  const restart = createCredits(directory); await restart.load([users[1]]);
  assert.equal((await restart.readiness()).initialSpecialAccountApplied, false);
  assert.equal((await restart.snapshot('special')).balance, 2000);
});
test('an exact zero balance blocks new instructions just like a negative balance', async t => {
  const f = await fixture(t);
  await f.credits.recordUsage('ordinary', 'task', price.modelId, 'zero', { input: 2000, output: 0, cachedInput: 0, audioInput: 0, cachedAudioInput: 0 }, { ...price, input: 1000 });
  assert.equal((await f.credits.snapshot('ordinary')).balance, 0);
  await assert.rejects(() => f.credits.admit('ordinary'), (error: unknown) => error instanceof CreditError && error.code === 'INSUFFICIENT_CREDITS');
});
test('concurrent calls persist exact debits and separate users; repeated provider request ID is idempotent', async t => {
  const f = await fixture(t);
  await Promise.all(Array.from({ length: 30 }, (_, i) => f.credits.recordUsage(i % 2 ? 'special' : 'ordinary', 'task', price.modelId, 'request-' + i, usage, price)));
  await f.credits.recordUsage('ordinary', 'other-task', price.modelId, 'request-0', usage, price);
  assert.equal((await f.credits.snapshot('ordinary')).balance, 1901);
  assert.equal((await f.credits.snapshot('special')).balance, 999901);
  assert.equal((await f.credits.history('ordinary')).total, 16);
  const restarted = createCredits(f.directory, { now: f.now }); await restarted.load(users);
  assert.equal((await restarted.snapshot('ordinary')).balance, 1901);
});
test('frozen model prices preserve historical charges, unknown models stop before upstream', async t => {
  const f = await fixture(t);
  const frozen = await f.credits.price(price.modelId);
  await f.credits.setPrice({ ...price, output: 1 });
  await f.credits.recordUsage('ordinary', 'task', price.modelId, 'frozen', usage, frozen);
  assert.equal((await f.credits.history('ordinary')).entries[0].price?.output, 30);
  let calls = 0; const original = globalThis.fetch; globalThis.fetch = async () => { calls++; return new Response('{}'); };
  try { await withCreditUsage(f.credits, 'ordinary', 'task', () => assert.rejects(() => jobFetch('https://provider.test/chat/completions', { method: 'POST', body: '{"model":"unknown-model"}' }), /价格/)); assert.equal(calls, 0); }
  finally { globalThis.fetch = original; }
});
test('JSON usage records real response ID and cache counts without persisting prompts or credentials', async t => {
  const f = await fixture(t), original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ id: 'real-response', usage: { prompt_tokens: 1000, completion_tokens: 100, prompt_tokens_details: { cached_tokens: 500 } }, choices: [] }));
  try {
    await withCreditUsage(f.credits, 'ordinary', 'task', async () => { const r = await jobFetch('https://provider.test/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer PRIVATE-SECRET' }, body: JSON.stringify({ model: price.modelId, messages: [{ content: 'PRIVATE-PROMPT' }] }) }); await r.json(); });
    const entry = (await f.credits.history('ordinary')).entries[0];
    assert.equal(entry.requestId, 'real-response'); assert.equal(entry.points, -6.6);
    const raw = await readFile(path.join(f.directory, 'credits.json'), 'utf8'); assert.ok(!/PRIVATE-PROMPT|PRIVATE-SECRET/.test(raw));
  } finally { globalThis.fetch = original; }
});
test('SSE parses split UTF-8, CRLF and final cumulative usage without buffering away streaming', async t => {
  const f = await fixture(t), original = globalThis.fetch;
  const raw = Buffer.from('data: {"id":"stream","choices":[{"delta":{"content":"你好"}}]}\r\n\r\n' + 'data: {"id":"stream","usage":{"prompt_tokens":1000,"completion_tokens":50}}\r\n\r\n' + 'data: {"id":"stream","usage":{"prompt_tokens":1000,"completion_tokens":100,"prompt_tokens_details":{"cached_tokens":500}}}\r\n\r\ndata: [DONE]\r\n\r\n');
  let index = 0;
  globalThis.fetch = async () => new Response(new ReadableStream({ pull(c) { if (index < raw.length) { c.enqueue(raw.subarray(index, index + 7)); index += 7; } else c.close(); } }), { headers: { 'Content-Type': 'text/event-stream' } });
  try {
    await withCreditUsage(f.credits, 'ordinary', 'task', async () => {
      const response = await creditFetch('https://provider.test/chat/completions', { method: 'POST', body: JSON.stringify({ model: price.modelId }) });
      assert.ok(index < raw.length, 'response returns before the final SSE event');
      assert.equal(await response.text(), raw.toString());
    });
    assert.equal((await f.credits.snapshot('ordinary')).balance, 1993.4); assert.equal((await f.credits.history('ordinary')).total, 2);
  } finally { globalThis.fetch = original; }
});
test('Responses API final usage is charged and non-model requests stay exempt', async t => {
  const f = await fixture(t), original = globalThis.fetch;
  globalThis.fetch = async () => new Response('event: response.completed\ndata: {"response":{"id":"resp-1","usage":{"input_tokens":1000,"output_tokens":100,"input_tokens_details":{"cached_tokens":500}}}}\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
  try {
    await withCreditUsage(f.credits, 'ordinary', 'task', async () => {
      await (await jobFetch('https://provider.test/responses', { method: 'POST', body: JSON.stringify({ model: price.modelId }) })).text();
      await (await jobFetch('https://provider.test/search', { method: 'POST', body: '{}' })).text();
    });
    assert.equal((await f.credits.snapshot('ordinary')).balance, 1993.4);
  } finally { globalThis.fetch = original; }
});
test('missing usage and unpartitioned audio are flagged, never estimated from text; failed requests do not debit', async t => {
  const f = await fixture(t), original = globalThis.fetch;
  let response = new Response('{"choices":[]}'); globalThis.fetch = async () => response;
  const call = async (audio = false) => withCreditUsage(f.credits, 'ordinary', 'task', async () => (await jobFetch('https://provider.test/chat/completions', { method: 'POST', body: JSON.stringify({ model: audio ? defaultTokenPrices()[3].modelId : price.modelId, messages: audio ? [{ content: [{ type: 'input_audio' }] }] : [] }) })).text());
  try {
    await call(); response = new Response('{"id":"audio","usage":{"prompt_tokens":1000,"completion_tokens":10}}'); await call(true);
    response = new Response('{"error":"unauthorized"}', { status: 401 }); await call();
    const history = await f.credits.history('ordinary'); assert.equal(history.wallet.balance, 2000); assert.equal(history.total, 3);
    assert.equal(history.entries[0].kind, 'usage_pending'); assert.match(history.entries[0].detail!, /音频/);
  } finally { globalThis.fetch = original; }
});
test('real Pi transport charges every tool turn, completes after balance becomes negative, and blocks the next command', async t => {
  const f = await fixture(t), original = globalThis.fetch;
  const taskId = await f.credits.admit('ordinary'); let calls = 0, submitted = false;
  globalThis.fetch = async (_input, init) => {
    const payload = JSON.parse(String(init?.body)); assert.equal(payload.stream_options.include_usage, true);
    const name = ++calls === 1 ? 'lookup' : 'submit';
    const base = { id: 'pi-' + calls, model: price.modelId, object: 'chat.completion.chunk', created: 1 };
    const events = [{ ...base, choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'call-' + calls, type: 'function', function: { name, arguments: '{}' } }] }, finish_reason: null }] }, { ...base, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 1000, completion_tokens: 80000, prompt_tokens_details: { cached_tokens: 500 } } }];
    return new Response(events.map(e => 'data: ' + JSON.stringify(e) + '\n\n').join('') + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
  };
  try {
    await withCreditUsage(f.credits, 'ordinary', taskId, async () => {
      const agent = getAgent({ id: 'text', modelId: price.modelId, provider: 'ark', name: 'test', kind: 'text', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', apiKey: 'test', enabled: true }, [
        { name: 'lookup', label: '查询', description: '查询', parameters: Type.Object({}), execute: async () => { assert.ok((await f.credits.snapshot('ordinary')).balance < 0); return { content: [{ type: 'text', text: 'found' }], details: {} }; } },
        { name: 'submit', label: '完成', description: '完成', parameters: Type.Object({}), execute: async () => { submitted = true; return { content: [{ type: 'text', text: 'done' }], details: {} }; } },
      ], '先查询再完成', true);
      agent.finishTurn = () => submitted ? { action: 'end' } : undefined;
      await agent.prompt('执行任务');
    });
    assert.equal(submitted, true); assert.equal(calls, 2); assert.equal((await f.credits.snapshot('ordinary')).balance, -2807.2);
    await assert.rejects(() => f.credits.admit('ordinary'), (e: unknown) => e instanceof CreditError && e.status === 402);
  } finally { globalThis.fetch = original; }
});
test('voice admission survives a negative balance but cannot be stolen, changed, replayed or used after expiry', async t => {
  const f = await fixture(t), taskId = await f.credits.admit('ordinary');
  await f.credits.recordUsage('ordinary', taskId, price.modelId, 'voice-cost', { ...usage, input: 0, cachedInput: 0, output: 100000 }, price);
  assert.equal((await f.credits.snapshot('ordinary')).balance, -1000);
  const ticket = await f.credits.voiceTicket('ordinary', taskId, '制作新闻视频');
  await assert.rejects(() => f.credits.admit('special', '制作新闻视频', ticket), /凭证/);
  await assert.rejects(() => f.credits.admit('ordinary', '制作另一个视频', ticket), /凭证/);
  assert.equal(await f.credits.admit('ordinary', '制作新闻视频', ticket), taskId);
  await assert.rejects(() => f.credits.admit('ordinary', '制作新闻视频', ticket), /凭证/);
  const expired = await f.credits.voiceTicket('ordinary', taskId, '同一指令'); f.advance(16 * 60000);
  await assert.rejects(() => f.credits.admit('ordinary', '同一指令', expired), /凭证/);
  assert.ok(!(await readFile(path.join(f.directory, 'credits.json'), 'utf8')).includes(ticket));
});
test('corrupt ledger cannot reset balances and failed atomic writes do not advance in-memory debits', async t => {
  const f = await fixture(t), file = path.join(f.directory, 'credits.json');
  const backup = await readFile(file, 'utf8'); await writeFile(file, '{corrupt');
  await assert.rejects(() => createCredits(f.directory).load(users));
  await rm(file); await mkdir(file);
  await assert.rejects(() => f.credits.recordUsage('ordinary', 'task', price.modelId, 'failed-write', usage, price));
  await rm(file, { recursive: true }); await writeFile(file, backup);
  assert.equal((await f.credits.snapshot('ordinary')).balance, 2000);
  await f.credits.recordUsage('ordinary', 'task', price.modelId, 'failed-write', usage, price);
  assert.equal((await f.credits.snapshot('ordinary')).balance, 1993.4);
});
test('failed persistence does not mark a check-in claimed or lose its retry', async t => {
  const f = await fixture(t), file = path.join(f.directory, 'credits.json');
  const backup = await readFile(file, 'utf8'); await rm(file); await mkdir(file);
  await assert.rejects(() => f.credits.checkIn('ordinary', '2026-10-06'));
  await rm(file, { recursive: true }); await writeFile(file, backup);
  const before = await f.credits.snapshot('ordinary');
  assert.equal(before.balance, 2000); assert.equal(before.canCheckIn, true);
  assert.equal((await f.credits.checkIn('ordinary', '2026-10-06')).wallet.balance, 3000);
});
test('v1 migration preserves balances, usage deduplication, prices and already-granted days without offline backfill', async t => {
  const f = await fixture(t), file = path.join(f.directory, 'credits.json');
  await f.credits.recordUsage('ordinary', 'existing-job', price.modelId, 'existing-response', usage, price);
  await f.credits.setPrice({ ...price, output: 20 });
  const saved = JSON.parse(await readFile(file, 'utf8'));
  saved.version = 1;
  saved.wallets = Object.fromEntries(Object.entries(saved.wallets).map(([id, value]) => {
    const w = value as any;
    return [id, { balanceMicros: id === 'ordinary' ? 993.4 * POINT_MICROS : w.balanceMicros, spentMicros: w.spentMicros, special: w.special, specialGranted: w.specialGranted, lastGrantDate: '2026-10-06' }];
  }));
  saved.entries = saved.entries.map((e: any) => e.kind === 'signup_grant' ? { ...e, kind: 'daily_grant', points: 1000, balance: 1000 } : e.kind === 'special_grant' ? { ...e, points: 999000 } : e.userId === 'ordinary' ? { ...e, balance: e.balance - 1000 } : e);
  await writeFile(file, JSON.stringify(saved));
  const migrated = createCredits(f.directory, { now: f.now }); await migrated.load(users);
  assert.equal((await migrated.snapshot('ordinary')).balance, 993.4);
  assert.equal((await migrated.checkIn('ordinary', '2026-10-06')).claimed, false);
  assert.equal((await migrated.snapshot('special')).balance, 1000000);
  assert.equal((await migrated.price(price.modelId)).output, 20);
  await migrated.recordUsage('ordinary', 'existing-job', price.modelId, 'existing-response', usage, price);
  assert.equal((await migrated.snapshot('ordinary')).balance, 993.4);
  const disk = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(disk.version, 2); assert.equal(disk.wallets.ordinary.initialGrantPoints, 1000);
  assert.deepEqual(disk.entries, saved.entries); assert.deepEqual(disk.seen, saved.seen);
  f.advance(3 * 86400000);
  assert.equal((await migrated.snapshot('ordinary')).balance, 993.4);
  assert.equal((await migrated.checkIn('ordinary', '2026-10-09')).wallet.balance, 1993.4);
  await migrated.setSpecial('ordinary', true);
  assert.equal((await migrated.snapshot('ordinary')).balance, 1000993.4, 'legacy initial allowance remains 1000 when topping up');
  await migrated.setSpecial('ordinary', false); await migrated.setSpecial('ordinary', true);
  assert.equal((await migrated.snapshot('ordinary')).balance, 1000993.4);
});
test('invalid persisted check-in dates and registration allowances fail closed', async t => {
  const f = await fixture(t), file = path.join(f.directory, 'credits.json');
  const saved = JSON.parse(await readFile(file, 'utf8'));
  for (const patch of [{ lastCheckInDate: '2026-02-30' }, { lastCheckInDate: 'yesterday' }, { initialGrantPoints: 1_000_000 }]) {
    const corrupt = structuredClone(saved); Object.assign(corrupt.wallets.ordinary, patch);
    await writeFile(file, JSON.stringify(corrupt));
    await assert.rejects(() => createCredits(f.directory).load(users), /积分账本/);
  }
});
