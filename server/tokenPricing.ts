import type { TokenPrice, TokenUsage } from '../shared/creditTypes';

export const POINT_MICROS = 1_000_000;
export const DAILY_POINTS = 1000;
export const SPECIAL_INITIAL_POINTS = 1_000_000;
export const POINT_VALUE_RMB = 0.001;
export const PRICING_SOURCE = 'https://docs.volcengine.com/docs/ark/model-pricing?lang=zh';

// RMB per million tokens, regular online inference, verified 2026-10-06.
export const defaultTokenPrices = (): TokenPrice[] => [
  { modelId: 'doubao-seed-2-1-pro-260915', input: 6, cachedInput: 1.2, output: 30 },
  { modelId: 'deepseek-v4-pro-ga-260813', input: 9, cachedInput: .3, output: 27 },
  { modelId: 'glm-5-3-flash-260828', input: .8, cachedInput: .23, output: 2.8 },
  { modelId: 'doubao-seed-2-1-lite-260915', input: .8, cachedInput: .16, audioInput: 12, cachedAudioInput: 2.4, output: 2.7 },
].map(price => ({ ...price, source: PRICING_SOURCE, updatedAt: '2026-10-06T00:00:00+08:00' }));

const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
export function tokenUsage(value: unknown): TokenUsage | undefined {
  if (!value || typeof value !== 'object') return;
  const raw = value as Record<string, any>;
  const input = count(raw.prompt_tokens ?? raw.input_tokens), output = count(raw.completion_tokens ?? raw.output_tokens);
  if (input === undefined || output === undefined) return;
  const details = raw.prompt_tokens_details ?? raw.input_tokens_details ?? {};
  const cachedInput = count(details.cached_tokens ?? raw.prompt_cache_hit_tokens ?? 0);
  const audioInput = count(details.audio_tokens ?? 0), cachedAudioInput = count(details.audio_cached_tokens ?? 0);
  if (cachedInput === undefined || audioInput === undefined || cachedAudioInput === undefined || cachedInput > input || audioInput > input || cachedAudioInput > audioInput || cachedAudioInput > cachedInput || input - audioInput < cachedInput - cachedAudioInput) return;
  // Completion tokens already include reasoning tokens: never count them twice.
  return { input, output, cachedInput, audioInput, cachedAudioInput };
}

export function validateTokenPrice(value: unknown): TokenPrice {
  if (!value || typeof value !== 'object') throw new Error('请填写模型价格。');
  const p = value as TokenPrice;
  if (typeof p.modelId !== 'string' || !/^[\w.-]{1,160}$/.test(p.modelId)) throw new Error('模型 ID 格式无效。');
  for (const field of ['input', 'cachedInput', 'output', 'audioInput', 'cachedAudioInput'] as const) {
    const n = p[field];
    if (n === undefined && (field === 'audioInput' || field === 'cachedAudioInput')) continue;
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 100000 || Math.abs(n * 1000 - Math.round(n * 1000)) > 1e-6) throw new Error('价格须为非负数，单位元/百万 token，最多三位小数。');
  }
  if (p.cachedInput > p.input || (p.cachedAudioInput !== undefined && (p.audioInput === undefined || p.cachedAudioInput > p.audioInput))) throw new Error('缓存价格不得高于对应输入价格。');
  return { modelId: p.modelId, input: p.input, cachedInput: p.cachedInput, output: p.output, ...(p.audioInput === undefined ? {} : { audioInput: p.audioInput }), ...(p.cachedAudioInput === undefined ? {} : { cachedAudioInput: p.cachedAudioInput }), source: PRICING_SOURCE, updatedAt: new Date().toISOString() };
}

export function tokenCostMicros(usage: TokenUsage, price: TokenPrice): number {
  if (usage.audioInput > 0 && price.audioInput === undefined || usage.cachedAudioInput > 0 && price.cachedAudioInput === undefined) throw new Error('该模型的音频 token 价格尚未配置。');
  const uncachedAudio = usage.audioInput - usage.cachedAudioInput;
  const cachedText = usage.cachedInput - usage.cachedAudioInput;
  const uncachedText = usage.input - usage.audioInput - cachedText;
  // One micro-point equals one nano-RMB. Price * 1000 is exact per token.
  const cost = uncachedText * Math.round(price.input * 1000) + cachedText * Math.round(price.cachedInput * 1000) + uncachedAudio * Math.round((price.audioInput ?? 0) * 1000) + usage.cachedAudioInput * Math.round((price.cachedAudioInput ?? 0) * 1000) + usage.output * Math.round(price.output * 1000);
  if (!Number.isSafeInteger(cost) || cost < 0) throw new Error('token 费用超出可安全记账的范围。');
  return cost;
}
