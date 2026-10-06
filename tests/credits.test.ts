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
test('Beijing midnight grants once, accumulated balance and negative debt survive restart', async t => {
  const f = await fixture(t);
  assert.equal((await f.credits.snapshot('ordinary')).balance, 1000);
  await f.credits.recordUsage('ordinary', 'accepted', price.modelId, 'big', { ...usage, input: 0, cachedInput: 0, output: 50000 }, price);
  assert.equal((await f.credits.snapshot('ordinary')).balance, -500);
  await assert.rejects(() => f.credits.admit('ordinary'), CreditError);
  f.advance(60000);
  assert.equal((await f.credits.snapshot('ordinary')).balance, 500);
  assert.equal((await f.credits.snapshot('ordinary')).balance, 500);
  assert.equal((await f.credits.snapshot('ordinary')).nextGrantAt, '2026-10-08T00:00:00+08:00');
  const restarted = createCredits(f.directory, { now: f.now }); await restarted.load(users);
  assert.equal((await restarted.snapshot('ordinary')).balance, 500);
  f.advance(3 * 86400000);
  assert.equal((await restarted.snapshot('ordinary')).balance, 3500);
  assert.equal((await stat(path.join(f.directory, 'credits.json'))).mode & 0o777, 0o600);
});
test('existing shikanon gets exactly one million; toggling special or registering the nickname cannot mint more', async t => {
  const f = await fixture(t);
  assert.equal((await f.credits.snapshot('special')).balance, 1000000);
  await f.credits.recordUsage('special', 'accepted', price.modelId, 'one', usage, price);
  await f.credits.setSpecial('special', false); await f.credits.setSpecial('special', true);
  assert.equal((await f.credits.snapshot('special')).balance, 999993.4);
  await f.credits.setSpecial('ordinary', true);
  assert.equal((await f.credits.snapshot('ordinary')).balance, 1000000);
  const restarted = createCredits(f.directory, { now: f.now }); await restarted.load([...users, { id: 'impersonator', displayName: 'shikanon', email: 'another@example.test' }]);
  assert.equal((await restarted.snapshot('impersonator')).balance, 1000);
  assert.equal((await restarted.snapshot('special')).balance, 999993.4);
});
test('an exact zero balance blocks new instructions just like a negative balance', async t => {
  const f = await fixture(t);
  await f.credits.recordUsage('ordinary', 'task', price.modelId, 'zero', { input: 1000, output: 0, cachedInput: 0, audioInput: 0, cachedAudioInput: 0 }, { ...price, input: 1000 });
  assert.equal((await f.credits.snapshot('ordinary')).balance, 0);
  await assert.rejects(() => f.credits.admit('ordinary'), (error: unknown) => error instanceof CreditError && error.code === 'INSUFFICIENT_CREDITS');
});
test('concurrent calls persist exact debits and separate users; repeated provider request ID is idempotent', async t => {
  const f = await fixture(t);
  await Promise.all(Array.from({ length: 30 }, (_, i) => f.credits.recordUsage(i % 2 ? 'special' : 'ordinary', 'task', price.modelId, 'request-' + i, usage, price)));
  await f.credits.recordUsage('ordinary', 'other-task', price.modelId, 'request-0', usage, price);
  assert.equal((await f.credits.snapshot('ordinary')).balance, 901);
  assert.equal((await f.credits.snapshot('special')).balance, 999901);
  assert.equal((await f.credits.history('ordinary')).total, 16);
  const restarted = createCredits(f.directory, { now: f.now }); await restarted.load(users);
  assert.equal((await restarted.snapshot('ordinary')).balance, 901);
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
    assert.equal((await f.credits.snapshot('ordinary')).balance, 993.4); assert.equal((await f.credits.history('ordinary')).total, 2);
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
    assert.equal((await f.credits.snapshot('ordinary')).balance, 993.4);
  } finally { globalThis.fetch = original; }
});
test('missing usage and unpartitioned audio are flagged, never estimated from text; failed requests do not debit', async t => {
  const f = await fixture(t), original = globalThis.fetch;
  let response = new Response('{"choices":[]}'); globalThis.fetch = async () => response;
  const call = async (audio = false) => withCreditUsage(f.credits, 'ordinary', 'task', async () => (await jobFetch('https://provider.test/chat/completions', { method: 'POST', body: JSON.stringify({ model: audio ? defaultTokenPrices()[3].modelId : price.modelId, messages: audio ? [{ content: [{ type: 'input_audio' }] }] : [] }) })).text());
  try {
    await call(); response = new Response('{"id":"audio","usage":{"prompt_tokens":1000,"completion_tokens":10}}'); await call(true);
    response = new Response('{"error":"unauthorized"}', { status: 401 }); await call();
    const history = await f.credits.history('ordinary'); assert.equal(history.wallet.balance, 1000); assert.equal(history.total, 3);
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
    const events = [{ ...base, choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'call-' + calls, type: 'function', function: { name, arguments: '{}' } }] }, finish_reason: null }] }, { ...base, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 1000, completion_tokens: 40000, prompt_tokens_details: { cached_tokens: 500 } } }];
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
    assert.equal(submitted, true); assert.equal(calls, 2); assert.equal((await f.credits.snapshot('ordinary')).balance, -1407.2);
    await assert.rejects(() => f.credits.admit('ordinary'), (e: unknown) => e instanceof CreditError && e.status === 402);
  } finally { globalThis.fetch = original; }
});
test('voice admission survives a negative balance but cannot be stolen, changed, replayed or used after expiry', async t => {
  const f = await fixture(t), taskId = await f.credits.admit('ordinary');
  await f.credits.recordUsage('ordinary', taskId, price.modelId, 'voice-cost', { ...usage, input: 0, cachedInput: 0, output: 50000 }, price);
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
  assert.equal((await f.credits.snapshot('ordinary')).balance, 1000);
  await f.credits.recordUsage('ordinary', 'task', price.modelId, 'failed-write', usage, price);
  assert.equal((await f.credits.snapshot('ordinary')).balance, 993.4);
});
