import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MAX_VOICE_BYTES, mountVoiceInputRoutes, recognizeVoice, voicePcm, voiceText, VoiceInputError } from '../server/voiceInput';
import { withModelSnapshot } from '../server/modelContext';
import type { ModelConfig } from '../server/modelRegistry';
import { runFFmpeg } from '../server/core';

function wav(seconds: number, tone = true) {
  const length = Math.floor(seconds * 16000), bytes = Buffer.alloc(44 + length * 2);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(16000, 24); bytes.writeUInt32LE(32000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(length * 2, 40);
  if (tone) for (let i = 0; i < length; i++) bytes.writeInt16LE(Math.round(Math.sin(i * 440 * 2 * Math.PI / 16000) * 5000), 44 + i * 2);
  return bytes;
}
const config = { id: 'voice-test', name: 'test', kind: 'understanding', provider: 'ark', baseUrl: 'https://voice-test.invalid', modelId: 'understanding-test', enabled: true, apiKey: 'private-voice-test-secret' } as ModelConfig;
const snapshot = { text: null, image: null, audio: null, understanding: config };

test('voice text preserves negation, version, and word content; empty and overlong speech cannot become commands', () => {
  assert.equal(voiceText([{ text: '先写Fable5.5分镜' }, { text: '不要生成成片' }]), '先写Fable5.5分镜 不要生成成片');
  assert.throws(() => voiceText([]), (e: unknown) => e instanceof VoiceInputError && e.code === 'NO_SPEECH');
  assert.throws(() => voiceText([{ text: 'a'.repeat(2001) }]), /过长/);
  assert.equal(voicePcm(wav(1, false)).rms, 0);
  assert.equal(voicePcm(wav(1)).duration, 1);
  assert.throws(() => voicePcm(Buffer.from('not-a-wave')), /WAV/);
});

test('real decoding rejects silence, corrupt audio, short and long recordings and always removes temporary files', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'qj-voice-'));
  try {
    for (const [input, code] of [[wav(1, false), 'NO_SPEECH'], [Buffer.from('not audio'), 'INVALID_AUDIO'], [Buffer.from('#EXTM3U\n#EXTINF:10\nhttp://127.0.0.1/private.wav\n'), 'INVALID_AUDIO'], [wav(.1), 'TOO_SHORT'], [wav(62), 'TOO_LONG']] as const) {
      await assert.rejects(() => recognizeVoice(input, dir), (e: unknown) => e instanceof VoiceInputError && e.code === code);
      assert.deepEqual(await readdir(dir), []);
    }
    await withModelSnapshot({ ...snapshot, understanding: null }, () => assert.rejects(() => recognizeVoice(wav(1), dir), /暂未配置/));
    assert.deepEqual(await readdir(dir), []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('actual audio worker receives decoded WAV and retries bad timestamp JSON; no command executes during recognition', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'qj-voice-worker-')), original = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async (_url, init) => {
      calls++; const body = JSON.parse(String(init?.body));
      assert.equal(body.model, config.modelId); assert.equal(body.messages[1].content[0].input_audio.format, 'wav');
      assert.equal(voicePcm(Buffer.from(body.messages[1].content[0].input_audio.data, 'base64')).duration, 1);
      assert.match(body.messages[0].content, /只执行原声音频识别/);
      const content = calls === 1 ? '{broken' : JSON.stringify({ sentences: [{ complete: true, words: [{ start: .1, end: .5, text: '不要' }, { start: .5, end: .9, text: '出片' }] }] });
      return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content } }] }), { status: 200 });
    };
    const result = await withModelSnapshot(snapshot, () => recognizeVoice(wav(1), dir));
    assert.equal(result.text, '不要出片'); assert.equal(calls, 2); assert.deepEqual(await readdir(dir), []);
    const source = path.join(dir, 'source.wav'); await writeFile(source, wav(1));
    globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ sentences: [{ complete: true, words: [{ start: .1, end: .5, text: '不要' }, { start: .5, end: .9, text: '出片' }] }] }) } }] }), { status: 200 });
    for (const [extension, codec] of [['webm', 'libopus'], ['mp4', 'aac'], ['ogg', 'libopus']]) {
      const file = path.join(dir, 'fixture.' + extension);
      await runFFmpeg(['-y', '-v', 'error', '-i', source, '-c:a', codec, file]);
      const bytes = await readFile(file);
      assert.equal((await withModelSnapshot(snapshot, () => recognizeVoice(bytes, dir))).text, '不要出片');
      await rm(file); assert.ok((await readdir(dir)).every(name => !name.startsWith('voice-')));
    }
    await rm(source);
    calls = 0; globalThis.fetch = async () => { calls++; return new Response(JSON.stringify({ error: { code: 'unauthorized' } }), { status: 401 }); };
    await withModelSnapshot(snapshot, () => assert.rejects(() => recognizeVoice(wav(1), dir), /HTTP 401/));
    assert.equal(calls, 1); assert.deepEqual(await readdir(dir), []);
  } finally { globalThis.fetch = original; await rm(dir, { recursive: true, force: true }); }
});

test('voice upload route enforces authenticated boundary, audio type and size and returns only transcript data', async () => {
  const app = express(); let calls = 0;
  app.use((_request, response, next) => { if (_request.get('x-test-user') !== 'yes') response.status(401).json({ error: 'login' }); else next(); });
  mountVoiceInputRoutes(app, tmpdir(), async () => { calls++; return { text: '先写分镜，不要出片', duration: 2 }; });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const upload = (bytes: Uint8Array, type = 'audio/webm') => { const form = new FormData(); form.append('audio', new Blob([bytes as BlobPart], { type }), 'recording'); return form; };
  try {
    assert.equal((await fetch(base + '/api/voice/transcribe', { method: 'POST', body: upload(wav(1)) })).status, 401);
    const send = (body: FormData) => fetch(base + '/api/voice/transcribe', { method: 'POST', headers: { 'x-test-user': 'yes' }, body });
    assert.equal((await send(upload(wav(1), 'image/png'))).status, 415);
    assert.equal((await send(upload(new Uint8Array(MAX_VOICE_BYTES + 1)))).status, 413);
    assert.equal((await send(new FormData())).status, 400);
    const response = await send(upload(wav(1))); assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { text: '先写分镜，不要出片', duration: 2 }); assert.equal(calls, 1);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
