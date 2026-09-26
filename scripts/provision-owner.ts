import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { hashPassword } from '../server/auth';

const dataDir = process.env.QINGJIAN_DATA_DIR;
const email = process.argv[2]?.trim().toLowerCase();
if (!dataDir || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  throw new Error('用法：QINGJIAN_DATA_DIR=/data/qingjian tsx scripts/provision-owner.ts <邮箱>');
}
const authFile = path.join(dataDir, 'auth.json');
const stateFile = path.join(dataDir, 'app-state.json');
const auth = await readFile(authFile, 'utf8').then((text) => JSON.parse(text)).catch((error: NodeJS.ErrnoException) => {
  if (error.code === 'ENOENT') return { users: [], sessions: [] };
  throw error;
});
const state = JSON.parse(await readFile(stateFile, 'utf8'));
auth.users ||= [];
auth.sessions ||= [];
state.profiles ||= {};
let user = auth.users.find((item: { email: string }) => item.email === email);
let temporaryPassword: string | null = null;
if (!user) {
  temporaryPassword = randomBytes(24).toString('base64url');
  user = { id: randomUUID(), email, displayName: email.split('@')[0], passwordHash: await hashPassword(temporaryPassword), createdAt: new Date().toISOString() };
  auth.users.push(user);
}
const legacySessions = (state.sessions || []).filter((item: { ownerId?: string }) => !item.ownerId);
const legacyCount = { sessions: legacySessions.length, media: 0, artifacts: 0, jobs: 0 };
for (const kind of ['sessions', 'media', 'artifacts', 'jobs'] as const) {
  for (const item of state[kind] || []) {
    if (!item.ownerId) { item.ownerId = user.id; if (kind !== 'sessions') legacyCount[kind]++; }
  }
}
if (legacySessions.length) {
  state.profiles[user.id] = { activeSessionId: state.activeSessionId, settings: { defaultModelId: null, language: state.settings?.language || 'zh-CN', chatBackground: state.settings?.chatBackground || null } };
}
async function saveAtomic(file: string, value: unknown) {
  const temp = `${file}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
  await rename(temp, file);
}
await saveAtomic(stateFile, state);
await saveAtomic(authFile, auth);
console.log(JSON.stringify({ email, userId: user.id, legacyCount, temporaryPassword }));
