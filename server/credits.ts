import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { PublicUser } from './auth';
import type { CreditAdminState, CreditCheckInResult, CreditEntry, CreditWallet, TokenPrice, TokenUsage, ImagePrice } from '../shared/creditTypes';
import { defaultImagePrices, validateImagePrice, imageCostMicros, imagePriceHash } from './imagePricing';
import { DAILY_POINTS, REGISTRATION_POINTS, SPECIAL_INITIAL_POINTS, POINT_MICROS, POINT_VALUE_RMB, defaultTokenPrices, tokenCostMicros, validateTokenPrice } from './tokenPricing';

interface Wallet { balanceMicros: number; reservedMicros?: number; spentMicros: number; special: boolean; specialGranted: boolean; initialGrantPoints: number; lastCheckInDate: string | null; }
interface LegacyWallet { balanceMicros: number; spentMicros: number; special: boolean; specialGranted: boolean; lastGrantDate: string; }
interface Ticket { userId: string; taskId: string; textHash: string; expiresAt: number; }
interface ImageReservation { userId:string; price:ImagePrice; remaining:string[]; }
interface Store { version: 2; initialized: boolean; specialUsers: string[]; wallets: Record<string, Wallet>; entries: CreditEntry[]; prices: TokenPrice[]; imagePrices?:ImagePrice[]; imageReservations?:Record<string,ImageReservation>; seen: Record<string, true>; tickets: Record<string, Ticket>; }
type LegacyStore = Omit<Store, 'version' | 'wallets'> & { version: 1; wallets: Record<string, LegacyWallet>; };
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const day = (at: number) => new Date(at).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
const dayNumber = (s: string) => Date.parse(s + 'T00:00:00Z') / 86400000;
const nextDay = (s: string) => new Date((dayNumber(s) + 1) * 86400000).toISOString().slice(0, 10) + 'T00:00:00+08:00';
const validDay = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(dayNumber(s)) && new Date(dayNumber(s) * 86400000).toISOString().slice(0, 10) === s;

export class CreditError extends Error {
  constructor(message = '积分不足，请前往「我的积分」查看余额与签到奖励。', readonly code = 'INSUFFICIENT_CREDITS', readonly status = 402) { super(message); this.name = 'CreditError'; }
}

export function createCredits(dataDir: string, options: { now?: () => number; initialSpecialName?: string } = {}) {
  const filename = path.join(dataDir, 'credits.json'), now = options.now ?? Date.now;
  let store: Store = { version: 2, initialized: false, specialUsers: [], wallets: {}, entries: [], prices: defaultTokenPrices(), imagePrices:defaultImagePrices(),imageReservations:{},seen: {}, tickets: {} };
  let tail = Promise.resolve();
  let initialSpecialUserId: string | undefined;
  async function transaction<T>(fn: (draft: Store) => T, forceSave = false): Promise<T> {
    const result = tail.then(async () => {
      const draft = structuredClone(store), value = fn(draft), snapshot = JSON.stringify(draft);
      if (forceSave || snapshot !== JSON.stringify(store)) {
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
    let current = draft.wallets[userId];
    if (!current) {
      current = draft.wallets[userId] = { balanceMicros: 0, spentMicros: 0, special: draft.specialUsers.includes(userId), specialGranted: false, initialGrantPoints: REGISTRATION_POINTS, lastCheckInDate: null };
      entry(draft, userId, 'signup_grant', REGISTRATION_POINTS * POINT_MICROS, { detail: '首次注册赠送积分，只发放一次' });
    }
    if (current.special && !current.specialGranted) {
      entry(draft, userId, 'special_grant', (SPECIAL_INITIAL_POINTS - current.initialGrantPoints) * POINT_MICROS, { detail: '特殊账户初始额度补足；历史消费保留，只发放一次' });
      current.specialGranted = true;
    }
    return current;
  }
  const publicWallet = (w: Wallet): CreditWallet => {
    const today = day(now()), next = nextDay(today);
    return { balance: (w.balanceMicros-(w.reservedMicros||0)) / POINT_MICROS, ...(w.reservedMicros?{reserved:w.reservedMicros/POINT_MICROS}:{}),dailyGrant: DAILY_POINTS, registrationGrant: REGISTRATION_POINTS, pointValueRmb: POINT_VALUE_RMB, special: w.special, checkInDate: today, canCheckIn: !w.lastCheckInDate || w.lastCheckInDate < today, lastCheckInDate: w.lastCheckInDate, nextCheckInAt: next, totalSpent: w.spentMicros / POINT_MICROS,
      // Preserve the old response fields for clients with a previous bundle.
      lastGrantDate: w.lastCheckInDate ?? today, nextGrantAt: next };
  };

  async function load(users: PublicUser[] = []) {
    await mkdir(dataDir, { recursive: true });
    let loaded: Store | LegacyStore = store;
    try { loaded = JSON.parse(await readFile(filename, 'utf8')) as Store | LegacyStore; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (!loaded || ![1, 2].includes(loaded.version) || typeof loaded.initialized !== 'boolean' || !Array.isArray(loaded.entries) || !Array.isArray(loaded.prices) || !loaded.wallets || Array.isArray(loaded.wallets) || !loaded.seen || !loaded.tickets || !Array.isArray(loaded.specialUsers) || loaded.specialUsers.some(id => typeof id !== 'string')) throw new Error('积分账本格式无效，不能重置余额。');
    for (const w of Object.values(loaded.wallets)) {
      if (!w || !Number.isSafeInteger(w.balanceMicros) || !Number.isSafeInteger(w.spentMicros) || w.spentMicros < 0 || typeof w.special !== 'boolean' || typeof w.specialGranted !== 'boolean') throw new Error('积分账本余额或日期无效。');
      if (loaded.version === 1 ? !validDay((w as LegacyWallet).lastGrantDate) : (![DAILY_POINTS, REGISTRATION_POINTS].includes((w as Wallet).initialGrantPoints) || (w as Wallet).lastCheckInDate !== null && !validDay((w as Wallet).lastCheckInDate))) throw new Error('积分账本余额或日期无效。');
    }
    const migrating = loaded.version === 1;
    store = loaded.version === 1 ? { ...loaded, version: 2, wallets: Object.fromEntries(Object.entries(loaded.wallets).map(([id, w]) => {
      const { lastGrantDate, ...rest } = w;
      // A previously granted day is already claimed; do not mint a duplicate.
      return [id, { ...rest, initialGrantPoints: DAILY_POINTS, lastCheckInDate: lastGrantDate }];
    })) } : loaded;
    for (const p of store.prices) validateTokenPrice(p);
    store.imagePrices ??= defaultImagePrices();store.imageReservations ??= {};
    if(!Array.isArray(store.imagePrices)||!store.imageReservations||Array.isArray(store.imageReservations))throw Error('图片积分账本无效，不能重置余额。');
    for(const p of store.imagePrices)validateImagePrice(p);
    const reserved:Record<string,number>={};
    for(const r of Object.values(store.imageReservations)){
      validateImagePrice(r.price);
      if(!store.wallets[r.userId]||!Array.isArray(r.remaining)||r.remaining.length>25||new Set(r.remaining).size!==r.remaining.length||r.remaining.some(id=>typeof id!=='string'||id.length>200))throw Error('图片预留记录无效。');
      reserved[r.userId]=(reserved[r.userId]||0)+r.remaining.length*imageCostMicros(r.price);
    }
    for(const [id,w] of Object.entries(store.wallets))if(!Number.isSafeInteger(w.reservedMicros||0)||(w.reservedMicros||0)!==(reserved[id]||0))throw Error('图片预留积分与账本不一致。');
    const name = options.initialSpecialName ?? 'shikanon';
    const byEmail = users.filter(u => u.email.toLowerCase().split('@')[0] === name.toLowerCase());
    const candidates = byEmail.length === 1 ? byEmail : users.filter(u => u.displayName.trim().toLowerCase() === name.toLowerCase());
    initialSpecialUserId = candidates.length === 1 ? candidates[0].id : undefined;
    await transaction(draft => {
      if (!draft.initialized) {
        // Bootstrap only an existing, uniquely identified account. Registering
        // this display name later cannot mint a special balance.
        if (initialSpecialUserId) draft.specialUsers.push(initialSpecialUserId);
        draft.initialized = true;
      }
      for (const user of users) wallet(draft, user.id);
    }, migrating);
  }
  const snapshot = (userId: string) => transaction(draft => publicWallet(wallet(draft, userId)));
  const checkIn = (userId: string, expectedDate: string): Promise<CreditCheckInResult> => transaction(draft => {
    const at = now(), today = day(at);
    if (expectedDate !== today) throw new CreditError('签到日期已变更，请重新打开签到卡片领取今日奖励。', 'CHECK_IN_DAY_CHANGED', 409);
    const current = wallet(draft, userId);
    if (current.lastCheckInDate && current.lastCheckInDate >= today) return { wallet: publicWallet(current), claimed: false, points: 0, date: today };
    entry(draft, userId, 'daily_checkin', DAILY_POINTS * POINT_MICROS, { at: new Date(at).toISOString(), detail: '每日签到奖励：' + today });
    current.lastCheckInDate = today;
    return { wallet: publicWallet(current), claimed: true, points: DAILY_POINTS, date: today };
  });
  async function admit(userId: string, text = '', voiceTicket?: string): Promise<string> {
    return transaction(draft => {
      const current = wallet(draft, userId);
      if (voiceTicket) {
        const key = hash(voiceTicket), ticket = draft.tickets[key];
        if (!ticket || ticket.userId !== userId || ticket.expiresAt <= now() || ticket.textHash !== hash(text.trim())) throw new CreditError('语音指令凭证已失效，请重新录制或使用文字发送。', 'INVALID_VOICE_TICKET', 409);
        delete draft.tickets[key];
        return ticket.taskId;
      }
      if (current.balanceMicros-(current.reservedMicros||0) <= 0) throw new CreditError();
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
  const imageKey=(userId:string,modelId:string,requestId:string)=>hash(JSON.stringify([userId,modelId,requestId]));
  function configuredImagePrice(draft:Store,modelId:string){
    const p=draft.imagePrices!.find(p=>p.modelId===modelId);
    if(!p)throw new CreditError('当前图片模型尚未配置积分价格，请联系管理员。','IMAGE_PRICE_UNCONFIGURED',503);
    return p;
  }
  const imagePricing=(modelId:string)=>transaction(draft=>{
    const p=configuredImagePrice(draft,modelId);return {price:structuredClone(p),pricingHash:imagePriceHash(p),pointsPerImage:imageCostMicros(p)/POINT_MICROS};
  });
  const imageQuote=(userId:string,modelId:string,requestIds:string[])=>transaction(draft=>{
    const price=configuredImagePrice(draft,modelId),remaining=requestIds.filter(id=>!draft.seen[imageKey(userId,modelId,id)]);
    return {pricingHash:imagePriceHash(price),imageCount:remaining.length,points:remaining.length*imageCostMicros(price)/POINT_MICROS,pointsPerImage:imageCostMicros(price)/POINT_MICROS};
  });
  const admitImages=(userId:string,modelId:string,requestIds:string[],pricingHash:string)=>transaction(draft=>{
    if(requestIds.length>25||new Set(requestIds).size!==requestIds.length||requestIds.some(id=>typeof id!=='string'||!id||id.length>200))throw Error('图片制作额度无效。');
    const current=wallet(draft,userId),price=configuredImagePrice(draft,modelId);
    if(!pricingHash||imagePriceHash(price)!==pricingHash)throw new CreditError('图片积分价格已更新，请更新小程序并刷新表情工坊，查看费用后重新提交。','IMAGE_PRICE_CHANGED',409);
    const remaining=requestIds.filter(id=>!draft.seen[imageKey(userId,modelId,id)]),cost=remaining.length*imageCostMicros(price);
    if(Object.values(draft.imageReservations!).some(r=>r.userId===userId&&r.price.modelId===modelId&&r.remaining.some(id=>remaining.includes(id))))throw new CreditError('此阶段已在制作中，请查看当前任务。','IMAGE_ALREADY_RESERVED',409);
    if(current.balanceMicros-(current.reservedMicros||0)<cost)throw new CreditError('本阶段需要 '+cost/POINT_MICROS+' 积分，当前可用余额不足。请前往「我的积分」查看。');
    // Even a zero-new-image repair has a reservation; it cannot add paid calls.
    const taskId=randomUUID();draft.imageReservations![taskId]={userId,price:structuredClone(price),remaining};current.reservedMicros=(current.reservedMicros||0)+cost;return taskId;
  });
  const assertImageBudget=(userId:string,taskId:string,modelId:string,requestId:string)=>transaction(draft=>{
    const r=draft.imageReservations![taskId];
    if(!r||r.userId!==userId||r.price.modelId!==modelId||!r.remaining.includes(requestId))throw new CreditError('图片制作额度已失效，请回到表情工坊刷新费用后重试。','IMAGE_RESERVATION_REQUIRED',409);
  });
  const recordImageUsage=(userId:string,taskId:string,modelId:string,requestId:string)=>transaction(draft=>{
    const key=imageKey(userId,modelId,requestId);if(draft.seen[key])return 0;
    const r=draft.imageReservations![taskId];
    if(!r||r.userId!==userId||r.price.modelId!==modelId||!r.remaining.includes(requestId))throw new CreditError('图片计费缺少已确认额度，已停止追加请求。','IMAGE_RESERVATION_REQUIRED',409);
    const current=wallet(draft,userId),amount=imageCostMicros(r.price);
    r.remaining=r.remaining.filter(id=>id!==requestId);current.reservedMicros=(current.reservedMicros||0)-amount;
    entry(draft,userId,'model_usage',-amount,{taskId,modelId,requestId,imagePrice:structuredClone(r.price),imageCount:1,detail:'表情图片生成：1张 × '+amount/POINT_MICROS+'积分；已有图片复用不重复扣费'});
    current.spentMicros+=amount;if(!Number.isSafeInteger(current.spentMicros))throw Error('累计积分超出可安全记账范围。');draft.seen[key]=true;return amount;
  });
  const releaseImages=(taskId:string)=>transaction(draft=>{
    const r=draft.imageReservations![taskId];if(!r)return;
    draft.wallets[r.userId].reservedMicros=(draft.wallets[r.userId].reservedMicros||0)-r.remaining.length*imageCostMicros(r.price);delete draft.imageReservations![taskId];
  });
  const releaseInactiveImages=(activeTaskIds:string[])=>transaction(draft=>{
    const active=new Set(activeTaskIds);
    for(const [id,r] of Object.entries(draft.imageReservations!))if(!active.has(id)){
      draft.wallets[r.userId].reservedMicros=(draft.wallets[r.userId].reservedMicros||0)-r.remaining.length*imageCostMicros(r.price);delete draft.imageReservations![id];
    }
  });
  const releaseTerminalImages=async(taskIds:string[])=>{
    await tail;if(!taskIds.some(id=>store.imageReservations?.[id]))return;
    return transaction(draft=>{
    const terminal=new Set(taskIds);
    for(const [id,r] of Object.entries(draft.imageReservations!))if(terminal.has(id)){
      draft.wallets[r.userId].reservedMicros=(draft.wallets[r.userId].reservedMicros||0)-r.remaining.length*imageCostMicros(r.price);delete draft.imageReservations![id];
    }
    });
  };
  const setImagePrice=(value:unknown)=>{const p=validateImagePrice(value);return transaction(draft=>{draft.imagePrices=[...draft.imagePrices!.filter(old=>old.modelId!==p.modelId),p];return p;});};
  const refundImageTask=(userId:string,taskId:string,reason:string)=>transaction(draft=>{
    const key='service-refund:'+taskId;if(draft.seen[key])return 0;
    const debits=draft.entries.filter(e=>e.userId===userId&&e.taskId===taskId&&e.imageCount&&e.points<0),amount=-debits.reduce((sum,e)=>sum+Math.round(e.points*POINT_MICROS),0);
    if(!amount)return 0;const current=wallet(draft,userId);
    entry(draft,userId,'service_refund',amount,{taskId,detail:reason.slice(0,240)});current.spentMicros=Math.max(0,current.spentMicros-amount);draft.seen[key]=true;return amount/POINT_MICROS;
  });
  async function refundImageProject(userId:string,projectId:string,phase:'samples'|'batch',reason:string){
    if(!/^[a-f0-9]{64}$/.test(projectId))throw Error('退款项目无效。');await tail;
    const sampleIds=new Set(['01','03','20','identity']);
    const tasks=new Set(store.entries.filter(e=>e.userId===userId&&e.imageCount&&e.points<0&&e.requestId?.startsWith(projectId+'_')&&sampleIds.has(e.requestId.slice(projectId.length+1))===(phase==='samples')).map(e=>e.taskId).filter((id):id is string=>Boolean(id)));
    let points=0;for(const id of tasks)if(!store.seen['service-refund:'+id])points+=await refundImageTask(userId,id,reason);return points;
  }
  const history = (userId: string, offset = 0, limit = 20) => transaction(draft => {
    const w = publicWallet(wallet(draft, userId)), all = draft.entries.filter(e => e.userId === userId).reverse();
    return { wallet: w, entries: all.slice(offset, offset + limit), total: all.length };
  });
  const adminState = (users: PublicUser[]): Promise<CreditAdminState> => transaction(draft => ({ accounts: users.map(user => ({ ...user, wallet: publicWallet(wallet(draft, user.id)) })), prices: structuredClone(draft.prices), imagePrices:structuredClone(draft.imagePrices!),dailyGrant: DAILY_POINTS, registrationGrant: REGISTRATION_POINTS, pointValueRmb: POINT_VALUE_RMB, specialInitial: SPECIAL_INITIAL_POINTS }));
  async function readiness() {
    await tail;
    const initial = initialSpecialUserId ? store.wallets[initialSpecialUserId] : undefined;
    // A deployment receipt without identifiers, balances or account lists.
    return { ready: store.initialized, initialSpecialAccountApplied: Boolean(initial?.special && initial.specialGranted) };
  }
  return { load, snapshot, checkIn, admit, voiceTicket, recordUsage, price, setSpecial, setPrice, history, adminState, readiness,imagePricing,imageQuote,admitImages,assertImageBudget,recordImageUsage,releaseImages,releaseInactiveImages,releaseTerminalImages,setImagePrice,refundImageTask,refundImageProject };
}

export type Credits = ReturnType<typeof createCredits>;
