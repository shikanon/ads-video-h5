import { createHash, randomBytes, randomInt, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { Express, NextFunction, Request, Response } from 'express';
import { sendRegistrationCode } from './resend';

const scrypt = promisify(scryptCallback);
const sessionLifetime = 30 * 24 * 60 * 60 * 1000;
const cookieName = 'qingjian_session';

export interface PublicUser { id: string; email: string; displayName: string; }
interface UserRecord extends PublicUser { passwordHash: string; createdAt: string; }
interface LoginSession { userId: string; tokenHash: string; expiresAt: number; }
interface VerificationRecord { email: string; hash: string; salt: string; expiresAt: number; sentAt: number; attempts: number; }
interface AuthStore { users: UserRecord[]; sessions: LoginSession[]; verifications: VerificationRecord[]; }

const normalizeEmail = (value: unknown) => typeof value === 'string' ? value.trim().toLowerCase() : '';
const tokenHash = (value: string) => createHash('sha256').update(value).digest('hex');
const safeUser = ({ id, email, displayName }: UserRecord): PublicUser => ({ id, email, displayName });
const passwordValid = (value: unknown): value is string => typeof value === 'string' && value.length >= 10 && value.length <= 256;
const emailValid = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
const codeHash = async (code: string, salt: string) => (await scrypt(code, Buffer.from(salt, 'hex'), 32) as Buffer).toString('hex');

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const key = await scrypt(password, Buffer.from(salt, 'hex'), 64) as Buffer;
  return `scrypt:${salt}:${key.toString('hex')}`;
}
async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [, salt, hex] = stored.split(':');
  if (!salt || !hex) return false;
  const expected = Buffer.from(hex, 'hex');
  const actual = await scrypt(password, Buffer.from(salt, 'hex'), expected.length) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function createAuth(dataDir: string, publicBase: string) {
  const filename = path.join(dataDir, 'auth.json');
  let store: AuthStore = { users: [], sessions: [], verifications: [] };
  let saveTail = Promise.resolve();
  const failures = new Map<string, { count: number; until: number }>();
  const sendLimits = new Map<string, { count: number; since: number }>();
  const sending = new Set<string>();
  const cookiePath = publicBase || '/';

  async function load() {
    store = await readFile(filename, 'utf8').then((value) => JSON.parse(value) as AuthStore).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return { users: [], sessions: [], verifications: [] };
      throw error;
    });
    if (!Array.isArray(store.users) || !Array.isArray(store.sessions)) throw new Error('帐号数据格式无效。');
    store.verifications ||= [];
  }
  function save() {
    const snapshot = JSON.stringify(store, null, 2);
    saveTail = saveTail.catch(() => undefined).then(async () => {
      const temp = `${filename}.${randomUUID()}.tmp`;
      await writeFile(temp, snapshot, { mode: 0o600 });
      await rename(temp, filename);
    });
    return saveTail;
  }
  function issueSession(response: Response, request: Request, userId: string) {
    const token = randomBytes(32).toString('base64url');
    store.sessions = store.sessions.filter((item) => item.expiresAt > Date.now());
    store.sessions.push({ userId, tokenHash: tokenHash(token), expiresAt: Date.now() + sessionLifetime });
    response.cookie(cookieName, token, { httpOnly: true, secure: request.secure, sameSite: 'lax', path: cookiePath, maxAge: sessionLifetime });
  }
  function currentUser(request: Request): PublicUser | null {
    const cookie = request.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
    if (!cookie) return null;
    const session = store.sessions.find((item) => item.tokenHash === tokenHash(cookie) && item.expiresAt > Date.now());
    const user = store.users.find((item) => item.id === session?.userId);
    return user ? safeUser(user) : null;
  }
  function sameOrigin(request: Request): boolean {
    const origin = request.get('origin');
    if (!origin) return true;
    try {
      const source = new URL(origin);
      const host = request.get('host');
      return source.host === host && source.protocol === (request.secure ? 'https:' : 'http:');
    } catch { return false; }
  }
  function mutationGuard(request: Request, response: Response, next: NextFunction) {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && !sameOrigin(request)) {
      response.status(403).json({ error: '请求来源无效。' });
      return;
    }
    next();
  }
  function requireAuth(request: Request, response: Response, next: NextFunction) {
    const user = currentUser(request);
    if (!user) { response.status(401).json({ error: '请先登录轻剪帐号。' }); return; }
    (request as Request & { user: PublicUser }).user = user;
    next();
  }
  function rateKey(request: Request, email: string) { return `${request.ip}:${email}`; }
  function isLimited(key: string) { const attempt = failures.get(key); return Boolean(attempt && attempt.count >= 5 && attempt.until > Date.now()); }
  function failed(key: string) {
    const previous = failures.get(key);
    const count = previous && previous.until > Date.now() ? previous.count + 1 : 1;
    failures.set(key, { count, until: Date.now() + (count >= 5 ? Math.min(15 * 60_000, 30_000 * 2 ** Math.min(count - 5, 5)) : 60_000) });
  }
  function sendCount(key: string) {
    const limit = sendLimits.get(key);
    return limit && Date.now() - limit.since < 60 * 60_000 ? limit.count : 0;
  }
  function countSend(key: string) {
    const limit = sendLimits.get(key);
    sendLimits.set(key, limit && Date.now() - limit.since < 60 * 60_000 ? { ...limit, count: limit.count + 1 } : { count: 1, since: Date.now() });
  }
  async function sendCode(request: Request, response: Response) {
    const email = normalizeEmail(request.body?.email);
    if (!emailValid(email)) { response.status(400).json({ error: '请输入有效的邮箱地址。' }); return; }
    if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM) { response.status(503).json({ error: '邮箱验证暂未配置，请稍后重试。' }); return; }
    if (store.users.some((user) => user.email === email)) { response.status(409).json({ error: '该邮箱已注册，请直接登录。' }); return; }
    const ipKey = `ip:${request.ip}`;
    const emailKey = `email:${email}`;
    const previous = store.verifications.find((item) => item.email === email);
    if (sending.has(email) || (previous && Date.now() - previous.sentAt < 60_000) || sendCount(ipKey) >= 8 || sendCount(emailKey) >= 4) {
      response.status(429).json({ error: '验证码发送过于频繁，请稍后再试。' }); return;
    }
    sending.add(email);
    try {
      const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
      const salt = randomBytes(16).toString('hex');
      const hash = await codeHash(code, salt);
      await sendRegistrationCode(email, code);
      store.verifications = store.verifications.filter((item) => item.email !== email && item.expiresAt > Date.now());
      store.verifications.push({ email, hash, salt, expiresAt: Date.now() + 10 * 60_000, sentAt: Date.now(), attempts: 0 });
      countSend(ipKey); countSend(emailKey);
      await save();
      response.json({ ok: true, expiresInSeconds: 600, resendAfterSeconds: 60 });
    } catch (error) {
      response.status(502).json({ error: error instanceof Error ? error.message : '验证码发送失败，请稍后重试。' });
    } finally { sending.delete(email); }
  }
  async function register(request: Request, response: Response) {
    const email = normalizeEmail(request.body?.email);
    const displayName = typeof request.body?.displayName === 'string' ? request.body.displayName.trim().slice(0, 40) : '';
    const password = request.body?.password;
    const verificationCode = typeof request.body?.verificationCode === 'string' ? request.body.verificationCode.trim() : '';
    if (!emailValid(email) || !displayName || !passwordValid(password)) {
      response.status(400).json({ error: '请填写名称、有效邮箱和至少 10 位密码。' }); return;
    }
    if (!/^\d{6}$/.test(verificationCode)) { response.status(400).json({ error: '请输入邮件中的 6 位验证码。' }); return; }
    const key = rateKey(request, email);
    const ipKey = `register:${request.ip}`;
    if (isLimited(key)) { response.status(429).json({ error: '尝试过于频繁，请稍后再试。' }); return; }
    if (isLimited(ipKey)) { response.status(429).json({ error: '注册过于频繁，请稍后再试。' }); return; }
    if (store.users.some((user) => user.email === email)) { failed(key); response.status(409).json({ error: '该邮箱已注册，请直接登录。' }); return; }
    const verification = store.verifications.find((item) => item.email === email);
    if (!verification || verification.expiresAt <= Date.now() || verification.attempts >= 5) {
      response.status(400).json({ error: '验证码已失效，请重新获取。' }); return;
    }
    const expected = Buffer.from(verification.hash, 'hex');
    const actual = Buffer.from(await codeHash(verificationCode, verification.salt), 'hex');
    if (!timingSafeEqual(expected, actual)) {
      verification.attempts++;
      failed(key);
      await save();
      response.status(400).json({ error: '验证码错误，请检查后重试。' }); return;
    }
    const passwordHash = await hashPassword(password);
    if (store.users.some((user) => user.email === email)) { response.status(409).json({ error: '该邮箱已注册，请直接登录。' }); return; }
    if (!store.verifications.includes(verification) || verification.expiresAt <= Date.now()) { response.status(400).json({ error: '验证码已失效，请重新获取。' }); return; }
    const user: UserRecord = { id: randomUUID(), email, displayName, passwordHash, createdAt: new Date().toISOString() };
    store.users.push(user);
    store.verifications = store.verifications.filter((item) => item.email !== email);
    failed(ipKey);
    issueSession(response, request, user.id);
    await save();
    response.status(201).json({ user: safeUser(user) });
  }
  async function login(request: Request, response: Response) {
    const email = normalizeEmail(request.body?.email);
    const password = request.body?.password;
    if (!email || typeof password !== 'string' || password.length > 256) { response.status(400).json({ error: '请输入邮箱和密码。' }); return; }
    const key = rateKey(request, email);
    if (isLimited(key)) { response.status(429).json({ error: '尝试过于频繁，请稍后再试。' }); return; }
    const user = store.users.find((item) => item.email === email);
    const valid = await verifyPassword(password, user?.passwordHash || await hashPassword('invalid-password'));
    if (!user || !valid) { failed(key); response.status(401).json({ error: '邮箱或密码错误。' }); return; }
    failures.delete(key);
    issueSession(response, request, user.id);
    await save();
    response.json({ user: safeUser(user) });
  }
  async function logout(request: Request, response: Response) {
    const cookie = request.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
    if (cookie) store.sessions = store.sessions.filter((item) => item.tokenHash !== tokenHash(cookie));
    response.clearCookie(cookieName, { httpOnly: true, secure: request.secure, sameSite: 'lax', path: cookiePath });
    await save();
    response.json({ ok: true });
  }
  async function changePassword(request: Request, response: Response) {
    const user = store.users.find((item) => item.id === userOf(request).id)!;
    const current = request.body?.currentPassword;
    const next = request.body?.newPassword;
    if (typeof current !== 'string' || !passwordValid(next)) { response.status(400).json({ error: '请输入当前密码和至少 10 位新密码。' }); return; }
    if (!(await verifyPassword(current, user.passwordHash))) { response.status(401).json({ error: '当前密码错误。' }); return; }
    user.passwordHash = await hashPassword(next);
    const cookie = request.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
    store.sessions = store.sessions.filter((item) => item.userId !== user.id || item.tokenHash === tokenHash(cookie || ''));
    await save();
    response.json({ ok: true });
  }
  function mount(app: Express) {
    app.get('/api/health', (_request, response) => response.json({ ok: true }));
    app.get('/api/auth/me', (request, response) => { const user = currentUser(request); response.status(user ? 200 : 401).json(user ? { user } : { error: '未登录。' }); });
    app.post('/api/auth/send-code', mutationGuard, (request, response, next) => { void sendCode(request, response).catch(next); });
    app.post('/api/auth/register', mutationGuard, (request, response, next) => { void register(request, response).catch(next); });
    app.post('/api/auth/login', mutationGuard, (request, response, next) => { void login(request, response).catch(next); });
    app.post('/api/auth/logout', mutationGuard, (request, response, next) => { void logout(request, response).catch(next); });
    app.patch('/api/auth/password', mutationGuard, requireAuth, (request, response, next) => { void changePassword(request, response).catch(next); });
    app.use('/api', mutationGuard, requireAuth);
  }
  return { load, mount, currentUser };
}

export function userOf(request: Request): PublicUser { return (request as Request & { user: PublicUser }).user; }
