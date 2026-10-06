import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { PublicUser } from './auth';
import type { CreditAdminState, CreditEntry, CreditWallet, TokenPrice, TokenUsage } from '../shared/creditTypes';
import { DAILY_POINTS, SPECIAL_INITIAL_POINTS, POINT_MICROS, POINT_VALUE_RMB, defaultTokenPrices, tokenCostMicros, validateTokenPrice } from './tokenPricing';

interface Wallet { balanceMicros: number; spentMicros: number; special: boolean; specialGranted: boolean; lastGrantDate: string; }
interface Ticket { userId: string; taskId: string; textHash: string; expiresAt: number; }
interface Store { version: 1; initialized: boolean; specialUsers: string[]; wallets: Record<string, Wallet>; entries: CreditEntry[]; prices: TokenPrice[]; seen: Record<string, true>; tickets: Record<string, Ticket>; }
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const day = (at: number) => new Date(at).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
const dayNumber = (s: string) => Date.parse(s + 'T00:00:00Z') / 86400000;
const nextDay = (s: string) => new Date((dayNumber(s) + 1) * 86400000).toISOString().slice(0, 10) + 'T00:00:00+08:00';

export class CreditError extends Error {
  constructor(message = '积分不足，请等待每日免费积分到账后再发送指令。', readonly code = 'INSUFFICIENT_CREDITS', readonly status = 402) { super(message); this.name = 'CreditError'; }
}

export function createCredits(dataDir: string, options: { now?: () => number; initialSpecialName?: string } = {}) {
  const filename = path.join(dataDir, 'credits.json'), now = options.now ?? Date.now;
  let store: Store = { version: 1, initialized: false, specialUsers: [], wallets: {}, entries: [], prices: defaultTokenPrices(), seen: {}, tickets: {} };
  let tail = Promise.resolve();
  async function transaction<T>(fn: (draft: Store) => T): Promise<T> {
    const result = tail.then(async () => {
      const draft = structuredClone(store), value = fn(draft), snapshot = JSON.stringify(draft);
      if (snapshot !== JSON.stringify(store)) {
        const tmp = filename + '.' + randomUUID() + '.tmp';
        await writeFile(tmp, snapshot, { mode: 0o600 });
        await rename(tmp, filename);
        store = draft;
      }
      return value;
    });
    tail = result.then(() => undefined, () => undefined);
    return result;
  }
  function entry(draft: Store, userId: string, kind: CreditEntry['kind'], amountMicros: number, metadata: Partial<CreditEntry> = {}) {
    const wallet = draft.wallets[userId];
    const balance = wallet.balanceMicros + amountMicros;
    if (!Number.isSafeInteger(balance)) throw new Error('积分余额超出可安全记账的范围。');
    wallet.balanceMicros = balance;
    draft.entries.push({ id: randomUUID(), userId, kind, at: new Date(now()).toISOString(), points: amountMicros / POINT_MICROS, balance: balance / POINT_MICROS, ...metadata });
  }
  function wallet(draft: Store, userId: string): Wallet {
    if (!userId || userId.length > 160) throw new Error('积分账户无效。');
    const today = day(now());
    let current = draft.wallets[userId];
    if (!current) {
      current = draft.wallets[userId] = { balanceMicros: 0, spentMicros: 0, special: draft.specialUsers.includes(userId), specialGranted: false, lastGrantDate: today };
      entry(draft, userId, 'daily_grant', DAILY_POINTS * POINT_MICROS, { detail: '每日免费积分：' + today });
    } else {
      const days = dayNumber(today) - dayNumber(current.lastGrantDate);
      if (days > 0) {
        entry(draft, userId, 'daily_grant', days * DAILY_POINTS * POINT_MICROS, { detail: `${current.lastGrantDate} 后 ${days} 天的每日免费积分` });
        current.lastGrantDate = today;
      }
    }
    if (current.special && !current.specialGranted) {
      entry(draft, userId, 'special_grant', (SPECIAL_INITIAL_POINTS - DAILY_POINTS) * POINT_MICROS, { detail: '特殊账户初始额度补足；历史消费保留，只发放一次' });
      current.specialGranted = true;
    }
    return current;
  }
  const publicWallet = (w: Wallet): CreditWallet => ({ balance: w.balanceMicros / POINT_MICROS, dailyGrant: DAILY_POINTS, pointValueRmb: POINT_VALUE_RMB, special: w.special, lastGrantDate: w.lastGrantDate, nextGrantAt: nextDay(w.lastGrantDate), totalSpent: w.spentMicros / POINT_MICROS });

  async function load(users: PublicUser[] = []) {
    await mkdir(dataDir, { recursive: true });
    try { store = JSON.parse(await readFile(filename, 'utf8')) as Store; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (store.version !== 1 || typeof store.initialized !== 'boolean' || !Array.isArray(store.entries) || !Array.isArray(store.prices) || !store.wallets || Array.isArray(store.wallets) || !store.seen || !store.tickets || !Array.isArray(store.specialUsers) || store.specialUsers.some(id => typeof id !== 'string')) throw new Error('积分账本格式无效，不能重置余额。');
    for (const w of Object.values(store.wallets)) if (!w || !Number.isSafeInteger(w.balanceMicros) || !Number.isSafeInteger(w.spentMicros) || w.spentMicros < 0 || typeof w.special !== 'boolean' || typeof w.specialGranted !== 'boolean' || !/^\d{4}-\d{2}-\d{2}$/.test(w.lastGrantDate) || !Number.isFinite(dayNumber(w.lastGrantDate)) || new Date(dayNumber(w.lastGrantDate) * 86400000).toISOString().slice(0, 10) !== w.lastGrantDate) throw new Error('积分账本余额或日期无效。');
    for (const p of store.prices) validateTokenPrice(p);
    await transaction(draft => {
      if (!draft.initialized) {
        const name = options.initialSpecialName ?? 'shikanon';
        // Bootstrap only an existing, uniquely identified account. Registering
        // this display name later cannot mint a special balance.
        const byEmail = users.filter(u => u.email.toLowerCase().split('@')[0] === name.toLowerCase());
        const candidates = byEmail.length === 1 ? byEmail : users.filter(u => u.displayName.trim().toLowerCase() === name.toLowerCase());
        if (candidates.length === 1) draft.specialUsers.push(candidates[0].id);
        draft.initialized = true;
      }
      for (const user of users) wallet(draft, user.id);
    });
  }
  const snapshot = (userId: string) => transaction(draft => publicWallet(wallet(draft, userId)));
  async function admit(userId: string, text = '', voiceTicket?: string): Promise<string> {
    return transaction(draft => {
      const current = wallet(draft, userId);
      if (voiceTicket) {
        const key = hash(voiceTicket), ticket = draft.tickets[key];
        if (!ticket || ticket.userId !== userId || ticket.expiresAt <= now() || ticket.textHash !== hash(text.trim())) throw new CreditError('语音指令凭证已失效，请重新录制或使用文字发送。', 'INVALID_VOICE_TICKET', 409);
        delete draft.tickets[key];
        return ticket.taskId;
      }
      if (current.balanceMicros <= 0) throw new CreditError();
      return randomUUID();
    });
  }
  async function voiceTicket(userId: string, taskId: string, text: string): Promise<string> {
    const token = randomUUID();
    await transaction(draft => {
      for (const [key, ticket] of Object.entries(draft.tickets)) if (ticket.expiresAt <= now()) delete draft.tickets[key];
      draft.tickets[hash(token)] = { userId, taskId, textHash: hash(text.trim()), expiresAt: now() + 15 * 60000 };
    });
    return token;
  }
  async function recordUsage(userId: string, taskId: string, modelId: string, requestId: string, usage: TokenUsage | undefined, price: TokenPrice, detail?: string) {
    await transaction(draft => {
      const key = hash(JSON.stringify([userId, modelId, requestId]));
      if (draft.seen[key]) return;
      const current = wallet(draft, userId);
      let amount = 0;
      try { if (usage) amount = tokenCostMicros(usage, price); }
      catch (error) { detail = error instanceof Error ? error.message : '费用明细不完整'; usage = undefined; }
      entry(draft, userId, usage ? 'model_usage' : 'usage_pending', -amount, { taskId, modelId, requestId, ...(usage ? { usage } : {}), price, ...(usage ? {} : { detail: detail || '供应商没有返回有效 token 用量；不根据文案长度估算扣分' }) });
      current.spentMicros += amount;
      if (!Number.isSafeInteger(current.spentMicros)) throw new Error('累计积分消费超出可安全记账的范围。');
      draft.seen[key] = true;
    });
  }
  async function price(modelId: string): Promise<TokenPrice> {
    await tail;
    const found = store.prices.find(p => p.modelId === modelId);
    if (!found) throw new CreditError('当前模型尚未配置积分价格，请联系管理员。', 'MODEL_PRICE_UNCONFIGURED', 503);
    return structuredClone(found);
  }
  async function setSpecial(userId: string, special: boolean) {
    if (typeof special !== 'boolean') throw new Error('特殊账户设置须为布尔值。');
    return transaction(draft => {
      const current = wallet(draft, userId);
      current.special = special;
      draft.specialUsers = special ? [...new Set([...draft.specialUsers, userId])] : draft.specialUsers.filter(id => id !== userId);
      return publicWallet(wallet(draft, userId));
    });
  }
  const setPrice = (value: unknown) => {
    const validated = validateTokenPrice(value);
    return transaction(draft => { draft.prices = [...draft.prices.filter(p => p.modelId !== validated.modelId), validated]; return validated; });
  };
  const history = (userId: string, offset = 0, limit = 20) => transaction(draft => {
    const w = publicWallet(wallet(draft, userId)), all = draft.entries.filter(e => e.userId === userId).reverse();
    return { wallet: w, entries: all.slice(offset, offset + limit), total: all.length };
  });
  const adminState = (users: PublicUser[]): Promise<CreditAdminState> => transaction(draft => ({ accounts: users.map(user => ({ ...user, wallet: publicWallet(wallet(draft, user.id)) })), prices: structuredClone(draft.prices), dailyGrant: DAILY_POINTS, pointValueRmb: POINT_VALUE_RMB, specialInitial: SPECIAL_INITIAL_POINTS }));
  return { load, snapshot, admit, voiceTicket, recordUsage, price, setSpecial, setPrice, history, adminState };
}

export type Credits = ReturnType<typeof createCredits>;
