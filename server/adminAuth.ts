import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Router, type Express, type NextFunction, type Request, type Response } from 'express';
import QRCode from 'qrcode';
import { hashPassword, verifyPassword } from './auth';
import { authenticatorUri, generateTotpSecret, verifyTotp } from './totp';
import type { AdminAccount, AdminLogin } from '../shared/adminAuthTypes';

interface Session { hash: string; expiresAt: number; }
interface Store {
  version: 1;
  username: 'admin';
  passwordHash: string;
  mustChangePassword: boolean;
  secretCiphertext?: string;
  lastTotpStep: number;
  recoveryHashes: string[];
  sessions: Session[];
}
interface Challenge { ip: string; expiresAt: number; attempts: number; }
interface Setup { secret: string; expiresAt: number; }
class AuthError extends Error {
  constructor(message: string, readonly status = 400, readonly code = 'ADMIN_AUTH_ERROR') { super(message); }
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const equalHash = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const passwordValid = (value: unknown): value is string => typeof value === 'string' && value.length >= 12 && value.length <= 256;
const bearer = (request: Request) => /^Bearer (.+)$/i.exec(request.get('authorization') || '')?.[1] || '';

export function createAdminAuth(dataDir: string, options: { now?: () => number; initialPassword?: string; sessionLifetime?: number } = {}) {
  const now = options.now || Date.now;
  const sessionLifetime = options.sessionLifetime || 8 * 60 * 60_000;
  const filename = path.join(dataDir, 'admin-auth.json');
  const initialPasswordFile = path.join(dataDir, 'admin-initial-password');
  const keyFile = path.join(dataDir, 'admin-auth-key');
  let key: Buffer, store: Store;
  let tail = Promise.resolve();
  const challenges = new Map<string, Challenge>();
  const setups = new Map<string, Setup>();
  const failures = new Map<string, { count: number; until: number }>();

  async function load() {
    await mkdir(dataDir, { recursive: true });
    try { key = Buffer.from((await readFile(keyFile, 'utf8')).trim(), 'hex'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const generated = randomBytes(32).toString('hex');
      try { await writeFile(keyFile, generated, { mode: 0o600, flag: 'wx' }); }
      catch (writeError) { if ((writeError as NodeJS.ErrnoException).code !== 'EEXIST') throw writeError; }
      key = Buffer.from((await readFile(keyFile, 'utf8')).trim(), 'hex');
    }
    if (key.length !== 32) throw new Error('管理员加密密钥格式无效。');
    try { store = JSON.parse(await readFile(filename, 'utf8')) as Store; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const configured = options.initialPassword ?? process.env.QINGJIAN_ADMIN_PASSWORD;
      const legacy = await readFile(path.join(dataDir, 'admin-token'), 'utf8').then(text => text.trim()).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return ''; throw error; });
      const password = configured || legacy || randomBytes(24).toString('base64url');
      if (!passwordValid(password)) throw new Error('管理员初始密码必须为 12–256 位，请设置 QINGJIAN_ADMIN_PASSWORD。');
      store = { version: 1, username: 'admin', passwordHash: await hashPassword(password), mustChangePassword: true, lastTotpStep: -1, recoveryHashes: [], sessions: [] };
      await writeFile(initialPasswordFile, `${password}\n`, { mode: 0o600 });
      await chmod(initialPasswordFile, 0o600);
      await save();
    }
    if (store.version !== 1 || store.username !== 'admin' || !store.passwordHash.startsWith('scrypt:') || !Array.isArray(store.sessions) || !Array.isArray(store.recoveryHashes)) throw new Error('管理员帐号数据格式无效。');
    if (store.secretCiphertext) decrypt(store.secretCiphertext);
    await Promise.all([filename, keyFile].map(file => chmod(file, 0o600)));
    if (!store.mustChangePassword) await rm(initialPasswordFile, { force: true });
  }
  async function save() {
    const temporary = `${filename}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(store, null, 2), { mode: 0o600 });
    await rename(temporary, filename);
  }
  function exclusive<T>(action: () => Promise<T>): Promise<T> {
    const operation = tail.then(async () => {
      const previous = structuredClone(store);
      try { return await action(); }
      catch (error) { store = previous; throw error; }
    });
    tail = operation.then(() => undefined, () => undefined);
    return operation;
  }
  function encrypt(secret: string) {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
    const bytes = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), bytes].map(part => part.toString('base64url')).join('.');
  }
  function decrypt(value: string) {
    const [iv, tag, bytes] = value.split('.').map(part => Buffer.from(part, 'base64url'));
    if (iv?.length !== 12 || tag?.length !== 16 || !bytes) throw new Error('Authenticator 密钥数据格式无效。');
    const cipher = createDecipheriv('aes-256-gcm', key, iv); cipher.setAuthTag(tag);
    return Buffer.concat([cipher.update(bytes), cipher.final()]).toString('utf8');
  }
  function account(): AdminAccount {
    return { username: store.username, mustChangePassword: store.mustChangePassword, totpEnabled: Boolean(store.secretCiphertext), recoveryCodesRemaining: store.recoveryHashes.length };
  }
  function issueSession(): AdminLogin {
    const token = randomBytes(32).toString('base64url'), expiresAt = now() + sessionLifetime;
    store.sessions = store.sessions.filter(session => session.expiresAt > now()).slice(-9);
    store.sessions.push({ hash: hash(token), expiresAt });
    return { token, expiresAt, account: account() };
  }
  function sessionOf(request: Request): Session | undefined {
    const token = bearer(request);
    return token ? store.sessions.find(session => equalHash(session.hash, hash(token)) && session.expiresAt > now()) : undefined;
  }
  function requireAdmin(request: Request, response: Response, next: NextFunction) {
    if (!sessionOf(request)) { response.status(401).json({ error: '管理员登录已失效，请重新登录。', code: 'ADMIN_UNAUTHORIZED' }); return; }
    if (store.mustChangePassword) { response.status(403).json({ error: '请先设置管理员密码。', code: 'ADMIN_PASSWORD_CHANGE_REQUIRED' }); return; }
    next();
  }
  function requireSession(request: Request) {
    const session = sessionOf(request);
    if (!session) throw new AuthError('管理员登录已失效，请重新登录。', 401, 'ADMIN_UNAUTHORIZED');
    return session;
  }
  function limit(request: Request) {
    const ip = failures.get(`ip:${request.ip}`), global = failures.get('admin');
    if ((ip && ip.count >= 8 && ip.until > now()) || (global && global.count >= 30 && global.until > now())) throw new AuthError('验证尝试过于频繁，请 15 分钟后再试。', 429);
    for (const [key, failure] of failures) if (failure.until <= now()) failures.delete(key);
  }
  function failed(request: Request, message = '账号、密码或验证码错误。'): never {
    for (const id of [`ip:${request.ip}`, 'admin']) {
      const previous = failures.get(id);
      failures.set(id, { count: previous && previous.until > now() ? previous.count + 1 : 1, until: previous && previous.until > now() ? previous.until : now() + 15 * 60_000 });
    }
    throw new AuthError(message, 401, 'ADMIN_CREDENTIALS_INVALID');
  }
  function succeeded(request: Request) { failures.delete(`ip:${request.ip}`); }
  function prune() {
    for (const [id, challenge] of challenges) if (challenge.expiresAt <= now()) challenges.delete(id);
    for (const [id, setup] of setups) if (setup.expiresAt <= now()) setups.delete(id);
  }
  function consumeFactor(request: Request) {
    if (!store.secretCiphertext) return;
    const code = typeof request.body?.code === 'string' ? request.body.code.trim() : '';
    const step = verifyTotp(decrypt(store.secretCiphertext), code, now(), store.lastTotpStep);
    if (step !== null) { store.lastTotpStep = step; return; }
    const recovery = code.toUpperCase().replace(/-/g, '');
    const index = /^[A-F0-9]{12}$/.test(recovery) ? store.recoveryHashes.findIndex(value => equalHash(value, hash(recovery))) : -1;
    if (index >= 0) { store.recoveryHashes.splice(index, 1); return true; }
    failed(request, '验证码错误、已过期或已使用，请输入下一个验证码或有效恢复码。');
  }
  async function confirmPassword(request: Request) {
    const password = request.body?.password;
    if (typeof password !== 'string' || password.length > 256 || !await verifyPassword(password, store.passwordHash)) failed(request);
  }
  function recoveryCodes() {
    const codes = Array.from({ length: 8 }, () => randomBytes(6).toString('hex').toUpperCase());
    store.recoveryHashes = codes.map(hash);
    return codes.map(code => code.match(/.{4}/g)!.join('-'));
  }
  function rotateSession() { store.sessions = []; challenges.clear(); setups.clear(); return issueSession(); }
  async function credentialChange(request: Request) {
    requireSession(request); limit(request);
    await confirmPassword(request);
    if (store.mustChangePassword) throw new AuthError('请先设置管理员密码。', 403, 'ADMIN_PASSWORD_CHANGE_REQUIRED');
    consumeFactor(request);
  }

  function mount(app: Express) {
    const router = Router();
    router.use((request, response, next) => {
      response.set('Cache-Control', 'no-store');
      response.set('Referrer-Policy', 'no-referrer');
      const origin = request.get('origin');
      if (origin && !['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
        if (origin !== `${request.protocol}://${request.get('host')}`) { response.status(403).json({ error: '请求来源无效。' }); return; }
      }
      next();
    });
    const route = (action: (request: Request) => Promise<unknown>) => async (request: Request, response: Response) => {
      try { response.json(await exclusive(() => action(request))); }
      catch (error) {
        if (error instanceof AuthError) response.status(error.status).json({ error: error.message, code: error.code });
        else response.status(500).json({ error: '管理员验证暂不可用，请稍后重试。' });
      }
    };
    router.post('/login', route(async request => {
      limit(request); prune();
      const username = request.body?.username, password = request.body?.password;
      if (username !== store.username || typeof password !== 'string' || password.length > 256) failed(request);
      await confirmPassword(request);
      if (store.secretCiphertext) {
        if (challenges.size >= 100) throw new AuthError('登录请求过于频繁，请稍后再试。', 429);
        const challenge = randomBytes(32).toString('base64url'), expiresAt = now() + 5 * 60_000;
        challenges.set(hash(challenge), { ip: request.ip || '', expiresAt, attempts: 0 });
        return { requiresTotp: true, challenge, expiresAt };
      }
      succeeded(request); const login = issueSession(); await save(); return login;
    }));
    router.post('/login/totp', route(async request => {
      limit(request); prune();
      const id = typeof request.body?.challenge === 'string' ? hash(request.body.challenge) : '';
      const challenge = challenges.get(id);
      if (!challenge || challenge.ip !== (request.ip || '')) failed(request, '登录验证已失效，请重新输入账号和密码。');
      if (++challenge.attempts >= 5) challenges.delete(id);
      const usedRecoveryCode = consumeFactor(request);
      challenges.delete(id); succeeded(request);
      const login = issueSession(); await save(); return { ...login, usedRecoveryCode: Boolean(usedRecoveryCode) };
    }));
    router.get('/session', route(async request => { requireSession(request); return { account: account() }; }));
    router.post('/logout', route(async request => {
      const token = bearer(request); store.sessions = store.sessions.filter(session => !equalHash(session.hash, hash(token)));
      setups.delete(hash(token)); await save(); return { ok: true };
    }));
    router.put('/password', route(async request => {
      requireSession(request); limit(request); await confirmPassword(request);
      const next = request.body?.newPassword;
      if (!passwordValid(next)) throw new AuthError('新密码必须为 12–256 位。');
      if (await verifyPassword(next, store.passwordHash)) throw new AuthError('新密码不能与当前密码相同。');
      consumeFactor(request);
      store.passwordHash = await hashPassword(next); store.mustChangePassword = false;
      const login = rotateSession(); await save(); await rm(initialPasswordFile, { force: true }).catch(() => undefined); succeeded(request); return login;
    }));
    router.post('/totp/setup', route(async request => {
      await credentialChange(request); prune();
      if (store.secretCiphertext) throw new AuthError('Authenticator 已绑定；更换设备时请先关闭当前绑定。', 409);
      const secret = generateTotpSecret(), expiresAt = now() + 10 * 60_000;
      const qrDataUrl = await QRCode.toDataURL(authenticatorUri(secret, store.username), { errorCorrectionLevel: 'M', width: 256, margin: 2 });
      setups.set(hash(bearer(request)), { secret, expiresAt });
      return { secret, qrDataUrl, expiresAt };
    }));
    router.post('/totp/enable', route(async request => {
      requireSession(request); limit(request); prune();
      if (store.mustChangePassword) throw new AuthError('请先设置管理员密码。', 403, 'ADMIN_PASSWORD_CHANGE_REQUIRED');
      if (store.secretCiphertext) throw new AuthError('Authenticator 已绑定。', 409);
      const setup = setups.get(hash(bearer(request)));
      if (!setup) throw new AuthError('绑定已过期，请重新生成二维码。');
      const step = verifyTotp(setup.secret, typeof request.body?.code === 'string' ? request.body.code.trim() : '', now());
      if (step === null) failed(request, '验证码不正确，请检查 Authenticator 中的轻剪账号和手机时间。');
      store.secretCiphertext = encrypt(setup.secret); store.lastTotpStep = step;
      const codes = recoveryCodes(), login = rotateSession(); await save(); succeeded(request); return { ...login, recoveryCodes: codes };
    }));
    router.post('/totp/disable', route(async request => {
      await credentialChange(request);
      if (!store.secretCiphertext) throw new AuthError('尚未绑定 Authenticator。');
      delete store.secretCiphertext; store.lastTotpStep = -1; store.recoveryHashes = [];
      const login = rotateSession(); await save(); succeeded(request); return login;
    }));
    router.post('/recovery-codes', route(async request => {
      await credentialChange(request);
      if (!store.secretCiphertext) throw new AuthError('请先绑定 Authenticator。');
      const codes = recoveryCodes(), login = rotateSession(); await save(); succeeded(request); return { ...login, recoveryCodes: codes };
    }));
    app.use('/api/admin/auth', router);
  }
  return { load, mount, requireAdmin };
}

export type AdminAuth = ReturnType<typeof createAdminAuth>;
