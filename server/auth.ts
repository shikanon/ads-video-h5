import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { Express, NextFunction, Request, Response } from 'express';

const scrypt = promisify(scryptCallback);
const sessionLifetime = 30 * 24 * 60 * 60 * 1000;
const cookieName = 'qingjian_session';

export interface PublicUser { id: string; email: string; displayName: string; }
interface UserRecord extends PublicUser { passwordHash: string; createdAt: string; }
interface LoginSession { userId: string; tokenHash: string; expiresAt: number; }
interface AuthStore { users: UserRecord[]; sessions: LoginSession[]; }

const normalizeEmail = (value: unknown) => typeof value === 'string' ? value.trim().toLowerCase() : '';
const tokenHash = (value: string) => createHash('sha256').update(value).digest('hex');
const safeUser = ({ id, email, displayName }: UserRecord): PublicUser => ({ id, email, displayName });
const passwordValid = (value: unknown): value is string => typeof value === 'string' && value.length >= 10 && value.length <= 256;

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
  let store: AuthStore = { users: [], sessions: [] };
  let saveTail = Promise.resolve();
  const failures = new Map<string, { count: number; until: number }>();
  const cookiePath = publicBase || '/';

  async function load() {
    store = await readFile(filename, 'utf8').then((value) => JSON.parse(value) as AuthStore).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return { users: [], sessions: [] };
      throw error;
    });
    if (!Array.isArray(store.users) || !Array.isArray(store.sessions)) throw new Error('帐号数据格式无效。');
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
  async function register(request: Request, response: Response) {
    const email = normalizeEmail(request.body?.email);
    const displayName = typeof request.body?.displayName === 'string' ? request.body.displayName.trim().slice(0, 40) : '';
    const password = request.body?.password;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || !displayName || !passwordValid(password)) {
      response.status(400).json({ error: '请填写名称、有效邮箱和至少 10 位密码。' }); return;
    }
    const key = rateKey(request, email);
    const ipKey = `register:${request.ip}`;
    if (isLimited(key)) { response.status(429).json({ error: '尝试过于频繁，请稍后再试。' }); return; }
    if (isLimited(ipKey)) { response.status(429).json({ error: '注册过于频繁，请稍后再试。' }); return; }
    if (store.users.some((user) => user.email === email)) { failed(key); response.status(409).json({ error: '该邮箱已注册，请直接登录。' }); return; }
    const passwordHash = await hashPassword(password);
    if (store.users.some((user) => user.email === email)) { response.status(409).json({ error: '该邮箱已注册，请直接登录。' }); return; }
    const user: UserRecord = { id: randomUUID(), email, displayName, passwordHash, createdAt: new Date().toISOString() };
    store.users.push(user);
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
    app.post('/api/auth/register', mutationGuard, (request, response, next) => { void register(request, response).catch(next); });
    app.post('/api/auth/login', mutationGuard, (request, response, next) => { void login(request, response).catch(next); });
    app.post('/api/auth/logout', mutationGuard, (request, response, next) => { void logout(request, response).catch(next); });
    app.patch('/api/auth/password', mutationGuard, requireAuth, (request, response, next) => { void changePassword(request, response).catch(next); });
    app.use('/api', mutationGuard, requireAuth);
  }
  return { load, mount, currentUser };
}

export function userOf(request: Request): PublicUser { return (request as Request & { user: PublicUser }).user; }
