import { useEffect, useState } from 'react';
import type { CreditEntry, CreditWallet } from '../shared/creditTypes';
import { formatPoints } from '../shared/creditFormat';
import './credits.css';

export interface CreditHistory { wallet: CreditWallet; entries: CreditEntry[]; total: number; }
export async function fetchCredits(endpoint: string, signal?: AbortSignal): Promise<CreditHistory> {
  const response = await fetch(endpoint, { signal });
  const value = await response.json() as CreditHistory & { error?: string };
  if (!response.ok) throw new Error(value.error || '无法读取积分。');
  return value;
}
const entryName = { daily_grant: '每日赠送', special_grant: '特殊账户额度', model_usage: '模型调用', usage_pending: '用量待核对' };
export default function CreditPanel({ wallet, endpoint, locale }: { wallet: CreditWallet; endpoint: string; locale: string }) {
  const [history, setHistory] = useState<CreditHistory | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const zh = locale === 'zh-CN';
  useEffect(() => {
    const controller = new AbortController();
    void fetchCredits(endpoint, controller.signal).then(setHistory).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '无法读取积分。'); });
    return () => controller.abort();
  }, [endpoint, wallet.balance]);
  async function more() {
    if (!history || busy) return;
    setBusy(true); setError('');
    try {
      const next = await fetchCredits(`${endpoint}?offset=${history.entries.length}`);
      setHistory({ ...next, entries: [...history.entries, ...next.entries] });
    } catch (cause) { setError(cause instanceof Error ? cause.message : '无法读取积分。'); }
    finally { setBusy(false); }
  }
  return <div className="setting-group credit-panel">
    <h2>{zh ? '我的积分' : 'My credits'}</h2>
    <div className="credit-amount"><strong>{formatPoints(wallet.balance)}</strong><span>{zh ? '积分' : 'points'}</span>{wallet.special ? <small>{zh ? '特殊账户' : 'Special account'}</small> : null}</div>
    <p>{zh ? '每天免费到账 1,000 积分，余额可累计。1 积分 = ¥0.001。' : '1,000 free points daily, with rollover. 1 point = ¥0.001.'}</p>
    <p>{zh ? '按实际 token 用量扣分，缓存命中享相应价格。积分不足时不能发起新指令，已开始的任务会继续完成。' : 'Actual token usage is charged at the model rate, including cached input. New instructions need a positive balance; accepted tasks continue to completion.'}</p>
    <p>{zh ? '下次赠送：' : 'Next grant: '}{new Date(wallet.nextGrantAt).toLocaleString(zh ? 'zh-CN' : 'en-US', { timeZone: 'Asia/Shanghai', hour12: false })}（UTC+8）</p>
    <details className="credit-history"><summary>{zh ? '积分记录' : 'Credit history'}</summary>
      {error ? <p role="alert">{error}</p> : null}
      {history ? <ul>{history.entries.map(entry => <li key={entry.id}>
        <div><strong>{zh ? entryName[entry.kind] : entry.kind.replaceAll('_', ' ')}</strong><time>{new Date(entry.at).toLocaleString(zh ? 'zh-CN' : 'en-US', { hour12: false })}</time>{entry.usage ? <small>{zh ? '输入 / 输出 / 缓存' : 'Input / output / cached'}：{entry.usage.input} / {entry.usage.output} / {entry.usage.cachedInput} token</small> : null}</div>
        <span className={entry.points < 0 ? '' : 'credit-plus'}>{entry.points > 0 ? '+' : ''}{formatPoints(entry.points)}</span>
      </li>)}</ul> : <p>{zh ? '正在读取…' : 'Loading…'}</p>}
      {history && history.entries.length < history.total ? <button type="button" disabled={busy} onClick={() => void more()}>{busy ? '…' : zh ? '更多记录' : 'Load more'}</button> : null}
    </details>
  </div>;
}
