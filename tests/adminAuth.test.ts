import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
import { createAdminAuth } from '../server/adminAuth';
import { mountAdminRoutes } from '../server/adminRoutes';
import { createEffectStore } from '../server/htmlEffects';
import { authenticatorUri, encodeBase32, totpCode, verifyTotp } from '../server/totp';
import type { AdminLogin, AdminChallenge, AdminTotpSetup } from '../shared/adminAuthTypes';

const initialPassword = 'QA-initial-password-123';
const nextPassword = 'QA-personal-password-456';
type Login = AdminLogin & { recoveryCodes: string[] };

async function fixture(migrate = false) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'qj-admin-auth-'));
  if (migrate) await writeFile(path.join(directory, 'admin-token'), initialPassword, { mode: 0o600 });
  let clock = 1_900_000_000_000;
  const app = express(); app.set('trust proxy', 'loopback'); app.use(express.json());
  const auth = createAdminAuth(directory, { now: () => clock, initialPassword: migrate ? undefined : initialPassword });
  await auth.load(); auth.mount(app);
  const effects = createEffectStore(directory); await effects.init(); mountAdminRoutes(app, effects, auth);
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  async function request(route: string, body?: unknown, token = '', method = body === undefined ? 'GET' : 'POST', headers: Record<string, string> = {}) {
    const response = await fetch(`${base}/api/admin${route}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json() as any, headers: response.headers };
  }
  async function login(password = initialPassword) { return request('/auth/login', { username: 'admin', password }); }
  async function prepare() {
    const first = await login(); assert.equal(first.status, 200);
    const changed = await request('/auth/password', { password: initialPassword, newPassword: nextPassword }, first.data.token, 'PUT');
    assert.equal(changed.status, 200); return changed.data as Login;
  }
  async function bind(token: string) {
    const setup = await request('/auth/totp/setup', { password: nextPassword }, token);
    assert.equal(setup.status, 200);
    const secret = setup.data.secret as string;
    const enabled = await request('/auth/totp/enable', { code: totpCode(secret, Math.floor(clock / 30_000)) }, token);
    assert.equal(enabled.status, 200); return { setup: setup.data as AdminTotpSetup, login: enabled.data as Login };
  }
  return { directory, app, auth, request, login, prepare, bind, now: () => clock, advance: (milliseconds: number) => { clock += milliseconds; }, close: async () => { await new Promise<void>(resolve => server.close(() => resolve())); await rm(directory, { recursive: true, force: true }); } };
}

test('Authenticator matches RFC 6238 SHA-1 vectors, key URI, clock tolerance and replay rejection', () => {
  const secret = encodeBase32(Buffer.from('12345678901234567890'));
  for (const [seconds, expected] of [[59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'], [1234567890, '89005924'], [2000000000, '69279037'], [20000000000, '65353130']] as const) {
    assert.equal(totpCode(secret, Math.floor(seconds / 30), 8), expected);
  }
  const now = 1_900_000_000_000, step = Math.floor(now / 30_000), code = totpCode(secret, step);
  assert.equal(verifyTotp(secret, code, now), step);
  assert.equal(verifyTotp(secret, code, now, step), null);
  assert.equal(verifyTotp(secret, totpCode(secret, step - 1), now), step - 1);
  assert.equal(verifyTotp(secret, totpCode(secret, step - 2), now), null);
  assert.equal(verifyTotp(secret, '12345', now), null);
  const uri = new URL(authenticatorUri(secret, 'admin'));
  assert.equal(uri.protocol, 'otpauth:'); assert.equal(uri.host, 'totp');
  assert.equal(decodeURIComponent(uri.pathname), '/轻剪:admin');
  assert.equal(uri.searchParams.get('secret'), secret); assert.equal(uri.searchParams.get('issuer'), '轻剪');
  assert.equal(uri.searchParams.get('digits'), '6'); assert.equal(uri.searchParams.get('period'), '30');
});

test('default admin migration requires a new password and cannot bypass account login with legacy token or user cookies', async () => {
  const f = await fixture(true);
  try {
    assert.equal((await f.request('/effects')).status, 401);
    assert.equal((await f.request('/effects', undefined, initialPassword)).status, 401);
    assert.equal((await f.request('/effects', undefined, '', 'GET', { Cookie: 'qingjian_session=ordinary-user' })).status, 401);
    const result = await f.login(); assert.equal(result.data.account.username, 'admin'); assert.equal(result.data.account.mustChangePassword, true);
    assert.equal((await f.request('/effects', undefined, result.data.token)).data.code, 'ADMIN_PASSWORD_CHANGE_REQUIRED');
    assert.equal((await f.request('/auth/totp/setup', { password: initialPassword }, result.data.token)).status, 403);
    const changed = await f.request('/auth/password', { password: initialPassword, newPassword: nextPassword }, result.data.token, 'PUT');
    assert.equal(changed.status, 200); assert.equal(changed.data.account.mustChangePassword, false);
    assert.equal((await f.request('/effects', undefined, result.data.token)).status, 401);
    assert.equal((await f.request('/effects', undefined, changed.data.token)).data.effects.length, 9);
    assert.equal((await f.login()).status, 401);
    const stored = await readFile(path.join(f.directory, 'admin-auth.json'), 'utf8');
    assert.ok(!stored.includes(nextPassword)); assert.ok(!stored.includes(changed.data.token)); assert.ok(stored.includes('scrypt:'));
    assert.equal((await stat(path.join(f.directory, 'admin-auth.json'))).mode & 0o777, 0o600);
    assert.equal((await stat(path.join(f.directory, 'admin-auth-key'))).mode & 0o777, 0o600);
    await assert.rejects(stat(path.join(f.directory, 'admin-initial-password')), { code: 'ENOENT' });
    assert.equal(await readFile(path.join(f.directory, 'admin-token'), 'utf8'), initialPassword, 'model encryption key must remain intact');
    const restored = createAdminAuth(f.directory, { now: f.now, initialPassword: 'different-bootstrap-password' }); await restored.load();
    const probe = express(); probe.use(express.json()); restored.mount(probe);
    const restoredServer = probe.listen(0, '127.0.0.1'); await once(restoredServer, 'listening');
    try {
      const response = await fetch(`http://127.0.0.1:${(restoredServer.address() as { port: number }).port}/api/admin/auth/session`, { headers: { Authorization: `Bearer ${changed.data.token}` } });
      assert.equal(response.status, 200, 'sessions and credentials survive a server restart');
    } finally { await new Promise<void>(resolve => restoredServer.close(() => resolve())); }
  } finally { await f.close(); }
});

test('scan binding validates a real code, encrypts the secret and invalidates all older admin sessions', async () => {
  const f = await fixture();
  try {
    const first = await f.prepare(); const other = await f.login(nextPassword);
    assert.equal((await f.request('/auth/totp/setup', { password: 'incorrect' }, first.token)).status, 401);
    const setup = await f.request('/auth/totp/setup', { password: nextPassword }, first.token);
    assert.equal(setup.status, 200); assert.equal(setup.headers.get('cache-control'), 'no-store');
    const png = PNG.sync.read(Buffer.from(setup.data.qrDataUrl.split(',')[1], 'base64'));
    assert.equal(png.width, 256); assert.equal(png.height, 256);
    assert.equal((await f.request('/auth/session', undefined, first.token)).data.account.totpEnabled, false);
    const step = Math.floor(f.now() / 30_000), code = totpCode(setup.data.secret, step);
    const wrong = totpCode(setup.data.secret, step + 10);
    assert.equal((await f.request('/auth/totp/enable', { code: wrong }, first.token)).status, 401);
    const enabled = await f.request('/auth/totp/enable', { code }, first.token);
    assert.equal(enabled.status, 200); assert.equal(enabled.data.account.totpEnabled, true); assert.equal(enabled.data.recoveryCodes.length, 8);
    assert.equal((await f.request('/effects', undefined, first.token)).status, 401);
    assert.equal((await f.request('/effects', undefined, other.data.token)).status, 401);
    assert.equal((await f.request('/effects', undefined, enabled.data.token)).status, 200);
    const challenge = (await f.login(nextPassword)).data as AdminChallenge;
    assert.equal(challenge.requiresTotp, true); assert.ok(!('token' in challenge));
    assert.equal((await f.request('/effects', undefined, challenge.challenge)).status, 401);
    assert.equal((await f.request('/auth/login/totp', { challenge: challenge.challenge, code })).status, 401, 'binding code cannot be replayed for login');
    f.advance(30_000);
    const nextCode = totpCode(setup.data.secret, Math.floor(f.now() / 30_000));
    const another = (await f.login(nextPassword)).data as AdminChallenge;
    const simultaneous = await Promise.all([challenge, another].map(item => f.request('/auth/login/totp', { challenge: item.challenge, code: nextCode })));
    assert.deepEqual(simultaneous.map(result => result.status).sort(), [200, 401], 'exactly one concurrent request may consume the same code');
    const stored = await readFile(path.join(f.directory, 'admin-auth.json'), 'utf8');
    assert.ok(!stored.includes(setup.data.secret));
    for (const recovery of enabled.data.recoveryCodes) assert.ok(!stored.includes(recovery.replace(/-/g, '')));
  } finally { await f.close(); }
});

test('recovery codes are single use; credential changes require both factors and revoke previous sessions', async () => {
  const f = await fixture();
  try {
    const base = await f.prepare(), bound = await f.bind(base.token), recovery = bound.login.recoveryCodes[0];
    const challenge = (await f.login(nextPassword)).data as AdminChallenge;
    const recovered = await f.request('/auth/login/totp', { challenge: challenge.challenge, code: recovery });
    assert.equal(recovered.status, 200); assert.equal(recovered.data.usedRecoveryCode, true);
    assert.equal(recovered.data.account.totpEnabled, true); assert.equal(recovered.data.account.recoveryCodesRemaining, 7);
    const challenge2 = (await f.login(nextPassword)).data as AdminChallenge;
    assert.equal((await f.request('/auth/login/totp', { challenge: challenge2.challenge, code: recovery })).status, 401);
    assert.equal((await f.request('/auth/password', { password: nextPassword, newPassword: 'updated-personal-password' }, recovered.data.token, 'PUT')).status, 401);
    f.advance(30_000); const code = totpCode(bound.setup.secret, Math.floor(f.now() / 30_000));
    assert.equal((await f.request('/auth/recovery-codes', { password: 'incorrect', code }, recovered.data.token)).status, 401);
    const rotated = await f.request('/auth/recovery-codes', { password: nextPassword, code }, recovered.data.token);
    assert.equal(rotated.status, 200); assert.equal(rotated.data.account.recoveryCodesRemaining, 8);
    assert.equal((await f.request('/effects', undefined, recovered.data.token)).status, 401);
    assert.equal((await f.request('/effects', undefined, bound.login.token)).status, 401);
    const challenge3 = (await f.login(nextPassword)).data as AdminChallenge;
    assert.equal((await f.request('/auth/login/totp', { challenge: challenge3.challenge, code: bound.login.recoveryCodes[1] })).status, 401);
    const changed = await f.request('/auth/password', { password: nextPassword, newPassword: 'updated-personal-password', code: rotated.data.recoveryCodes[0] }, rotated.data.token, 'PUT');
    assert.equal(changed.status, 200);
    assert.equal((await f.request('/effects', undefined, rotated.data.token)).status, 401);
    assert.equal((await f.login(nextPassword)).status, 401);
    assert.equal((await f.login('updated-personal-password')).data.requiresTotp, true);
    const disabled = await f.request('/auth/totp/disable', { password: 'updated-personal-password', code: rotated.data.recoveryCodes[1] }, changed.data.token);
    assert.equal(disabled.status, 200); assert.equal(disabled.data.account.totpEnabled, false); assert.equal(disabled.data.account.recoveryCodesRemaining, 0);
    assert.ok((await f.login('updated-personal-password')).data.token);
    await f.request('/auth/logout', undefined, disabled.data.token, 'POST');
    assert.equal((await f.request('/effects', undefined, disabled.data.token)).status, 401);
  } finally { await f.close(); }
});

test('expired setups, challenges and sessions fail closed; login is rate limited and foreign-origin mutations are rejected', async () => {
  const f = await fixture();
  try {
    const login = await f.prepare();
    const foreign = await f.request('/auth/totp/setup', { password: nextPassword }, login.token, 'POST', { Origin: 'https://other.example' }); assert.equal(foreign.status, 403);
    const setup = await f.request('/auth/totp/setup', { password: nextPassword }, login.token);
    f.advance(11 * 60_000);
    assert.equal((await f.request('/auth/totp/enable', { code: totpCode(setup.data.secret, Math.floor(f.now() / 30_000)) }, login.token)).status, 400);
    const bound = await f.bind(login.token), challenge = (await f.login(nextPassword)).data as AdminChallenge;
    f.advance(6 * 60_000);
    assert.equal((await f.request('/auth/login/totp', { challenge: challenge.challenge, code: totpCode(bound.setup.secret, Math.floor(f.now() / 30_000)) })).status, 401);
    const ipChallenge = (await f.login(nextPassword)).data as AdminChallenge;
    assert.equal((await f.request('/auth/login/totp', { challenge: ipChallenge.challenge, code: bound.login.recoveryCodes[0] }, '', 'POST', { 'X-Forwarded-For': '198.51.100.12' })).status, 401);
    f.advance(8 * 60 * 60_000);
    assert.equal((await f.request('/effects', undefined, bound.login.token)).status, 401);
    for (let attempt = 0; attempt < 8; attempt++) assert.equal((await f.login('incorrect')).status, 401);
    assert.equal((await f.login(nextPassword)).status, 429);
    f.advance(15 * 60_000 + 1); assert.equal((await f.login(nextPassword)).status, 200);
  } finally { await f.close(); }
});
