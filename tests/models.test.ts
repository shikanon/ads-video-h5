import test from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { Type } from 'typebox';
import { getAgent, answerWithPi } from '../server/core';
import { ARK_BASE_URL, TEXT_MODEL_PRESETS } from '../shared/textModels';
import { withModelSnapshot } from '../server/modelContext';

const execute = promisify(execFile);

test('registry upgrade preserves existing choices and safely shares rotating Ark text credentials', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'qj-model-registry-'));
  const previousDirectory = process.env.QINGJIAN_DATA_DIR;
  const token = 'test-admin-token';
  const secret = 'test-text-credential';
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', createHash('sha256').update(`qingjian-model-registry:${token}`).digest(), iv);
  const encrypted = Buffer.concat([cipher.update(secret), cipher.final()]);
  const apiKeyCiphertext = [iv, cipher.getAuthTag(), encrypted].map(value => value.toString('base64url')).join('.');
  const file = path.join(directory, 'provider-models.json');
  const original = { id: 'existing-text', name: '原有自定义名称', provider: 'ark', kind: 'text' as const, modelId: TEXT_MODEL_PRESETS[0].modelId, baseUrl: ARK_BASE_URL, enabled: true, apiKeyCiphertext };
  await writeFile(path.join(directory, 'admin-token'), token, { mode: 0o600 });
  await writeFile(file, JSON.stringify({ version: 1, defaultTextModelId: original.id, models: [original] }), { mode: 0o600 });
  process.env.QINGJIAN_DATA_DIR = directory;
  const registry = await import('../server/modelRegistry');
  const restart = async () => {
    const { stdout } = await execute(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `const r=await import(${JSON.stringify(new URL('../server/modelRegistry.ts', import.meta.url).href)}); console.log(JSON.stringify(await r.listAdminModels()));`], { env: { ...process.env, QINGJIAN_DATA_DIR: directory } });
    return JSON.parse(stdout) as Awaited<ReturnType<typeof registry.listAdminModels>>;
  };
  try {
    await registry.listPublicModels();
    assert.equal(await registry.getDefaultTextModelId(), original.id);
    const stored = JSON.parse(await readFile(file, 'utf8'));
    assert.deepEqual(stored.models.find((model: { id: string }) => model.id === original.id), original);
    assert.equal(stored.models.filter((model: { kind: string }) => model.kind === 'text').length, 3);
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    for (const preset of TEXT_MODEL_PRESETS) {
      const publicModel = (await registry.listPublicModels()).find(model => model.modelId === preset.modelId)!;
      assert.ok(publicModel);
      assert.equal((await registry.getModelConfig('text', publicModel.id))?.apiKey, secret);
    }
    assert.doesNotMatch(JSON.stringify(await registry.listAdminModels()), /apiKeyCiphertext|apiKeySourceId|test-text-credential/);
    assert.doesNotMatch(await readFile(file, 'utf8'), /test-text-credential/);
    const beforeRestart = await readFile(file, 'utf8');
    assert.equal((await restart()).filter(model => model.kind === 'text').length, 3);
    assert.equal(await readFile(file, 'utf8'), beforeRestart);

    const deepseek = TEXT_MODEL_PRESETS[1], glm = TEXT_MODEL_PRESETS[2];
    await registry.setDefaultTextModelId(deepseek.id);
    assert.equal((await registry.getModelConfig('text'))?.modelId, deepseek.modelId);
    await registry.upsertModel({ ...original, apiKey: 'rotated-test-credential' });
    assert.equal((await registry.getModelConfig('text', deepseek.id))?.apiKey, 'rotated-test-credential');
    await registry.upsertModel({ ...deepseek, provider: 'ark', kind: 'text', baseUrl: ARK_BASE_URL, enabled: true, apiKey: 'independent-test-credential' });
    await registry.upsertModel({ ...original, apiKey: 'rotated-again-test-credential' });
    assert.equal((await registry.getModelConfig('text', deepseek.id))?.apiKey, 'independent-test-credential');
    assert.equal((await registry.getModelConfig('text', glm.id))?.apiKey, 'rotated-again-test-credential');

    await registry.upsertModel({ ...original, baseUrl: 'https://different.example/api' });
    assert.equal(await registry.getModelConfig('text', glm.id), null);
    assert.ok(!(await registry.listPublicModels()).some(model => model.id === glm.id));
    await registry.upsertModel({ ...original, enabled: false });
    assert.equal((await registry.getModelConfig('text', deepseek.id))?.apiKey, 'independent-test-credential');
    assert.equal((await restart()).find(model => model.id === original.id)?.enabled, false);
    await registry.setDefaultTextModelId(null);
    assert.equal((await registry.getModelConfig('text'))?.modelId, deepseek.modelId);
    const pinned = await registry.getModelConfig('text', deepseek.id);
    await withModelSnapshot({ text: pinned, image: null, audio: null, understanding: null }, async () => {
      await registry.upsertModel({ ...deepseek, provider: 'ark', kind: 'text', baseUrl: ARK_BASE_URL, enabled: true, apiKey: 'new-independent-test-credential' });
      assert.equal((await registry.getModelConfig('text', deepseek.id))?.apiKey, 'independent-test-credential');
      assert.equal(await registry.getModelConfig('text', original.id), null);
    });
    assert.equal((await registry.getModelConfig('text', deepseek.id))?.apiKey, 'new-independent-test-credential');
    await registry.deleteModel(glm.id);
    assert.ok(!(await restart()).some(model => model.id === glm.id));
  } finally {
    if (previousDirectory === undefined) delete process.env.QINGJIAN_DATA_DIR;
    else process.env.QINGJIAN_DATA_DIR = previousDirectory;
    await rm(directory, { recursive: true, force: true });
  }
});

function streamReply(model: string, tool?: { name: string; arguments: object }, reasoning = '') {
  const chunks = [
    { delta: { role: 'assistant', ...(reasoning ? { reasoning_content: reasoning } : {}) }, finish_reason: null },
    { delta: tool ? { tool_calls: [{ index: 0, id: 'call-1', type: 'function', function: { name: tool.name, arguments: JSON.stringify(tool.arguments) } }] } : { content: '完成' }, finish_reason: null },
    { delta: {}, finish_reason: tool ? 'tool_calls' : 'stop' },
  ];
  return new Response(chunks.map(choice => `data: ${JSON.stringify({ id: 'test', object: 'chat.completion.chunk', created: 1, model, choices: [{ index: 0, ...choice }] })}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
}

for (const preset of TEXT_MODEL_PRESETS) {
  test(`${preset.modelId}: Pi streams tools, validates results and replays them with compatible thinking`, async () => {
    const payloads: any[] = [];
    const calls: string[] = [];
    const originalFetch = globalThis.fetch;
    let result = 0;
    globalThis.fetch = async (input, init) => {
      assert.equal(String(input), `${ARK_BASE_URL}/chat/completions`);
      payloads.push(JSON.parse(String(init?.body)));
      return streamReply(preset.modelId, payloads.length === 1 ? { name: 'lookup', arguments: { key: 'duration' } } : { name: 'submit', arguments: { seconds: 12 } }, preset.id === 'ark-text-glm' ? 'private-model-reasoning' : '');
    };
    const agent = getAgent({ ...preset, provider: 'ark', kind: 'text', baseUrl: ARK_BASE_URL, apiKey: 'test-key', enabled: true }, [
      { name: 'lookup', label: '查询', description: '查询实际时长', parameters: Type.Object({ key: Type.String() }), execute: async (_id, args) => { calls.push('lookup'); assert.equal(args.key, 'duration'); return { content: [{ type: 'text', text: '12 seconds' }], details: {} }; } },
      { name: 'submit', label: '提交', description: '提交实际时长', parameters: Type.Object({ seconds: Type.Number() }), execute: async (_id, args) => { calls.push('submit'); result = args.seconds; return { content: [{ type: 'text', text: 'accepted' }], details: {} }; } },
    ], '必须查询后提交。', true);
    agent.finishTurn = () => result ? { action: 'end' } : undefined;
    try {
      await agent.prompt('查询并提交时长。');
      assert.equal(result, 12);
      assert.deepEqual(calls, ['lookup', 'submit']);
      assert.equal(payloads.length, 2);
      for (const payload of payloads) {
        assert.equal(payload.model, preset.modelId);
        assert.equal(payload.messages[0].role, 'system');
        assert.equal(payload.thinking.type, preset.id === 'ark-text-glm' ? 'enabled' : 'disabled');
        assert.equal(payload.tool_choice, 'required');
        assert.equal(payload.max_completion_tokens, undefined);
        assert.ok(payload.max_tokens >= 32768);
        assert.equal(payload.store, undefined);
      }
      assert.ok(payloads[1].messages.some((message: any) => message.role === 'tool' && message.content === '12 seconds'));
      if (preset.id === 'ark-text-glm') assert.equal(payloads[1].messages.find((message: any) => message.role === 'assistant').reasoning_content, 'private-model-reasoning');
    } finally { globalThis.fetch = originalFetch; }
  });
}

test('GLM reasoning stays out of published conversation replies', async () => {
  const originalFetch = globalThis.fetch;
  const visible: string[] = [];
  let requests = 0;
  const preset = TEXT_MODEL_PRESETS[2];
  globalThis.fetch = async () => ++requests === 1 ? streamReply(preset.modelId, { name: 'reply', arguments: { sections: ['可见说明'], summary: '可见答复' } }, 'private-model-reasoning') : streamReply(preset.modelId);
  try {
    const reply = await answerWithPi('回答问题', { ...preset, provider: 'ark', kind: 'text', baseUrl: ARK_BASE_URL, apiKey: 'test-key', enabled: true }, [], [], async (_id, text) => { visible.push(text); });
    assert.equal(reply, '可见答复');
    assert.ok(visible.includes('可见说明'));
    assert.doesNotMatch(visible.join(''), /private-model-reasoning/);
  } finally { globalThis.fetch = originalFetch; }
});
