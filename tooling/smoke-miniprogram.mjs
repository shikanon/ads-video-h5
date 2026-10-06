import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Run against a dedicated, operator-provisioned QA account. Never prints
// credentials or cookies. This verifies native transport, not WeChat devices.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'apps/miniprogram/package.json'));
const shippedConfig = require('./miniprogram/config.js');
const isolatedApi = process.env.QINGJIAN_MINI_QA_ISOLATED_API;
if (isolatedApi) assert.match(isolatedApi, /^http:\/\/127\.0\.0\.1:\d+\/api$/, 'Isolated QA must use a loopback-only backend.');
const config = isolatedApi ? { ...shippedConfig, apiBase: isolatedApi, allowLocal: true } : shippedConfig;
const project = JSON.parse(await readFile(path.join(root, 'apps/miniprogram/project.config.json')));
const credentialsFile = process.env.QINGJIAN_MINI_QA_CREDENTIALS;
if (!credentialsFile) throw new Error('Set QINGJIAN_MINI_QA_CREDENTIALS to a private JSON file for a dedicated QA account.');
const credentials = JSON.parse(await readFile(credentialsFile));
assert.equal(credentials.purpose, 'qingjian-deployment-qa');
assert.match(credentials.email, /^mini-deploy-[^@]+@example\.invalid$/);
assert.equal(typeof credentials.password, 'string');
assert.ok(credentials.password.length >= 24);
const base = new URL(config.apiBase).origin;
const h5Origin = process.env.QINGJIAN_MINI_QA_H5_ORIGIN || (isolatedApi ? base : 'https://video.shikanon.com');
assert.ok((isolatedApi ? [base] : [base, 'https://video.shikanon.com']).includes(h5Origin), 'H5 QA must use the isolated backend or a known Qingjian domain.');
const apiPath = new URL(config.apiBase).pathname;
const expected = JSON.parse(await readFile(path.join(root, 'dist/release.json'))).revision;
const { createClient } = require('./miniprogram/utils/api.js');
const directory = await mkdtemp(path.join(tmpdir(), 'qingjian-mini-smoke-'));
const report = { at: new Date().toISOString(), environment: isolatedApi ? 'isolated-loopback' : h5Origin === base ? 'domestic-public' : 'shared-production', expectedRevision: expected, appid: project.appid, apiBase: config.apiBase, h5Origin, checks: {}, nativeDevice: 'not-tested' };
const record = (key, value) => { report.checks[key] = value; console.log(JSON.stringify({ check: key, result: value })); };
const deadline = ms => AbortSignal.timeout(ms);

function platform(origin = base, h5 = false) {
  const storage = new Map();
  const network = async (options, form) => {
    assert.equal(new URL(options.url).origin, origin);
    const response = await fetch(options.url, { method: form ? 'POST' : options.method,
      headers: { Referer: h5 ? origin + '/' : `https://servicewechat.com/${project.appid}/dev/page-frame.html`, ...(h5 ? { Origin: origin } : {}), ...options.header },
      body: form || (options.data === undefined ? undefined : JSON.stringify(options.data)), signal: deadline(options.timeout) });
    const data = await response.text();
    options.success({ statusCode: response.status, header: Object.fromEntries(response.headers), cookies: response.headers.getSetCookie(), data });
  };
  return {
    getStorageSync: name => storage.get(name), setStorageSync: (name, value) => storage.set(name, value), removeStorageSync: name => storage.delete(name),
    request(options) { network(options).catch(options.fail); },
    uploadFile(options) {
      (async () => {
        const body = new FormData();
        for (const [key, value] of Object.entries(options.formData)) body.append(key, String(value));
        body.append(options.name, new Blob([await readFile(options.filePath)], { type: 'application/octet-stream' }), path.basename(options.filePath));
        await network(options, body);
      })().catch(options.fail);
      return { onProgressUpdate() {} };
    },
    downloadFile(options) {
      (async () => {
        assert.equal(new URL(options.url).origin, origin);
        const response = await fetch(options.url, { headers: options.header, signal: deadline(options.timeout) });
        const tempFilePath = path.join(directory, randomUUID());
        await writeFile(tempFilePath, Buffer.from(await response.arrayBuffer()), { mode: 0o600 });
        options.success({ statusCode: response.status, tempFilePath });
      })().catch(options.fail);
    },
  };
}

const client = createClient(platform(), config);
const secondClient = createClient(platform(h5Origin, true), { ...config, apiBase: h5Origin + apiPath });
try {
  const health = await fetch(config.apiBase + '/health', { signal: deadline(15000) }).then(r => r.json());
  assert.equal(health.ok, true); assert.equal(health.revision, expected);
  assert.equal((await fetch(config.apiBase + '/state', { signal: deadline(15000) })).status, 401);
  assert.equal((await fetch(config.apiBase + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://invalid.example' }, body: '{}', signal: deadline(15000) })).status, 403);
  const h5Health = await fetch(h5Origin + apiPath + '/health', { signal: deadline(15000) }).then(r => r.json());
  assert.equal(h5Health.revision, expected);
  record(isolatedApi ? 'loopbackRevisionAndUnauthenticatedIsolation' : 'httpsRevisionAndUnauthenticatedIsolation', 'passed');
  const login = { email: credentials.email, password: credentials.password };
  const nativeLogin = await client.request('/api/auth/login', login), h5Login = await secondClient.request('/api/auth/login', login);
  assert.equal(h5Login.user.id, nativeLogin.user.id);
  let state = await client.request('/api/state'); assert.equal(state.mode, 'pi');
  record('nativeLoginAndConfiguredModels', { mode: state.mode, availableModels: state.models.length });
  state = await client.request('/api/sessions', {});
  assert.equal((await secondClient.request('/api/state')).activeSessionId, state.activeSessionId);
  const fromH5 = await secondClient.request('/api/sessions', {});
  state = await client.request('/api/state'); assert.equal(state.activeSessionId, fromH5.activeSessionId);
  record(isolatedApi ? 'isolatedClientSessionSync' : h5Origin === base ? 'domesticOnlySessionSync' : 'existingH5AndNativeBidirectionalSessionSync', 'passed');
  const before = await client.request('/api/credits');
  const claim = await client.request('/api/credits/check-in', { date: before.wallet.checkInDate });
  const duplicate = await secondClient.request('/api/credits/check-in', { date: before.wallet.checkInDate });
  assert.equal(duplicate.claimed, false); assert.equal(duplicate.wallet.balance, claim.wallet.balance);
  if (before.wallet.canCheckIn) { assert.equal(claim.claimed, true); assert.equal(claim.wallet.balance - before.wallet.balance, 1000); }
  record('dailyCheckInIsIdempotent', { balanceBefore: before.wallet.balance, balanceAfter: claim.wallet.balance });

  const { PNG } = require('pngjs');
  const image = new PNG({ width: 32, height: 32 }); image.data.fill(255);
  const png = path.join(directory, 'qa.png'), video = path.join(directory, 'qa.mp4'), mp3 = path.join(directory, 'qa.mp3');
  await writeFile(png, PNG.sync.write(image));
  execFileSync('/usr/bin/ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=320x568:r=12:d=3', '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', video]);
  execFileSync('/usr/bin/ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1.5', '-c:a', 'libmp3lame', mp3]);
  let videoId;
  for (const [file, kind] of [[png, 'image'], [video, 'video'], [mp3, 'audio']]) {
    const uploaded = await client.upload('/api/media', file, 'files');
    assert.equal(uploaded.uploadedMediaIds.length, 1);
    const media = uploaded.media.find(m => m.id === uploaded.uploadedMediaIds[0]);
    assert.equal(media.kind, kind);
    const protectedPath = apiPath + '/media/' + media.id;
    assert.deepEqual(await readFile(await client.download(protectedPath)), await readFile(file));
    assert.deepEqual(await readFile(await secondClient.download(protectedPath)), await readFile(file));
    if (kind === 'video') videoId = media.id;
  }
  record('nativeBinaryUploadsAndAuthenticatedDownloads', 'PNG, MP4, MP3 passed');

  let message = '把附加的视频剪成三秒竖屏成片，保留原素材画面，不要旁白或音乐，直接导出。', voiceTicket;
  if (process.env.QINGJIAN_MINI_QA_VOICE === '1') {
    assert.ok(process.env.QINGJIAN_DATA_DIR, 'Voice QA requires the server private data directory.');
    const { getModelConfig } = await import(pathToFileURL(path.join(root, 'server/modelRegistry.ts')));
    const { generateAudio } = await import(pathToFileURL(path.join(root, 'server/providers.ts')));
    const audioConfig = await getModelConfig('audio'); assert.ok(audioConfig);
    const speech = await generateAudio(message, audioConfig);
    const recording = path.join(directory, 'spoken-command.mp3'); await writeFile(recording, speech.bytes);
    const recognized = await client.upload('/api/voice/transcribe', recording, 'audio', { prefix: '' });
    assert.ok(recognized.text.length > 8); assert.ok(recognized.creditTicket);
    assert.match(recognized.text, /视频|成片/); message = recognized.text; voiceTicket = recognized.creditTicket;
    record('realSpeechTranscriptionBeforeAgent', { duration: recognized.duration, characters: message.length });
  }
  const admitted = await client.request('/api/chat', { sessionId: state.activeSessionId, message, attachmentIds: [videoId], ...(voiceTicket ? { voiceTicket } : {}) });
  const job = admitted.jobs.filter(j => j.sessionId === state.activeSessionId).at(-1); assert.ok(job);
  let finished;
  for (let attempt = 0; attempt < 150; attempt++) {
    state = await client.request('/api/state'); finished = state.jobs.find(j => j.id === job.id);
    if (finished && !['queued', 'running', 'stopping'].includes(finished.status)) break;
    if (attempt % 15 === 0) console.log(JSON.stringify({ jobStatus: finished?.status, completedSteps: finished?.workflow?.length || 0 }));
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  assert.equal(finished?.status, 'succeeded', finished?.error || 'Agent did not complete');
  const artifact = state.artifacts.find(a => a.jobId === job.id && a.kind === 'video') || state.artifacts.filter(a => a.sessionId === state.activeSessionId && a.kind === 'video').at(-1);
  assert.ok(artifact, 'No completed video artifact');
  const output = await client.download(artifact.downloadUrl);
  const probe = JSON.parse(execFileSync('/usr/bin/ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', output], { encoding: 'utf8' }));
  const picture = probe.streams.find(s => s.codec_type === 'video'); assert.ok(picture); assert.ok(picture.height > picture.width);
  assert.ok(Number(probe.format.duration) >= 2.5);
  execFileSync('/usr/bin/ffmpeg', ['-v', 'error', '-i', output, '-f', 'null', '-']);
  record('realAgentVideoExportAndDecode', { jobId: job.id, artifactId: artifact.id, width: picture.width, height: picture.height, duration: Number(probe.format.duration) });
  const ledger = await client.request('/api/credits');
  const h5Ledger = await secondClient.request('/api/credits');
  assert.equal(h5Ledger.wallet.balance, ledger.wallet.balance); assert.equal(h5Ledger.wallet.totalSpent, ledger.wallet.totalSpent);
  record('actualTokenBilling', { modelUsageEntries: ledger.entries.filter(e => e.kind === 'model_usage').length, pendingUsageEntries: ledger.entries.filter(e => e.kind === 'usage_pending').length, totalSpent: ledger.wallet.totalSpent });
  report.passed = true;
} catch (error) {
  report.passed = false; report.error = error.message;
  console.error(JSON.stringify({ failed: true, error: error.message })); process.exitCode = 1;
} finally {
  for (const value of [client, secondClient]) { if (value.hasSession()) await value.request('/api/auth/logout', {}).catch(() => {}); }
  if (process.env.QINGJIAN_MINI_QA_REPORT) await writeFile(process.env.QINGJIAN_MINI_QA_REPORT, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  await rm(directory, { recursive: true, force: true });
}
