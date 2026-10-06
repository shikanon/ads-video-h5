import type { CreditCheckInResult, CreditEntry, CreditWallet } from '../shared/creditTypes';

export interface CreditHistory { wallet: CreditWallet; entries: CreditEntry[]; total: number; }
async function creditRequest<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const response = await fetch(endpoint, options);
  const value = await response.json() as T & { error?: string };
  if (!response.ok) throw Object.assign(new Error(value.error || '无法读取积分。'), { status: response.status });
  return value;
}
export const fetchCredits = (endpoint: string, signal?: AbortSignal) => creditRequest<CreditHistory>(endpoint, { signal });
export const claimCheckIn = (endpoint: string, date: string, signal?: AbortSignal) => creditRequest<CreditCheckInResult>(`${endpoint}/check-in`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date }), signal,
});
