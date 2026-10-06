import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ArrowRight, CalendarCheck2, Check, Coins, Gift, Sparkles, X } from 'lucide-react';
import type { CreditCheckInResult, CreditEntry, CreditWallet } from '../shared/creditTypes';
import { formatPoints } from '../shared/creditFormat';
import { claimCheckIn, fetchCredits, type CreditHistory } from './creditApi';
import './credits.css';

const names: Record<CreditEntry['kind'], [string, string]> = {
  signup_grant: ['注册赠送', 'Welcome gift'], daily_checkin: ['每日签到', 'Daily check-in'], daily_grant: ['每日赠送', 'Daily grant'],
  special_grant: ['特殊账户额度', 'Special allowance'], model_usage: ['模型调用', 'Model usage'], usage_pending: ['用量待核对', 'Usage pending'],
};
const sparks = Array.from({ length: 12 }, (_, i) => ({ x: `${Math.cos(i * Math.PI / 6) * 125}px`, y: `${Math.sin(i * Math.PI / 6) * 110}px`, delay: `${i % 3 * .06}s` }));

function RewardCard({ day, amount, zh, endpoint, onWallet, onClose }: { day: string; amount: number; zh: boolean; endpoint: string; onWallet: (wallet: CreditWallet) => void; onClose: () => void; }) {
  const dialog = useRef<HTMLDialogElement>(null), controller = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [result, setResult] = useState<CreditCheckInResult | null>(null);
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => { controller.current?.abort(); node?.close(); };
  }, []);
  async function claim() {
    if (busy || result || expired) return;
    setBusy(true); setError('');
    const abort = new AbortController(); controller.current = abort;
    const timer = window.setTimeout(() => abort.abort(), 20000);
    try {
      const next = await claimCheckIn(endpoint, day, abort.signal);
      onWallet(next.wallet); setResult(next);
    } catch (cause) {
      if ((cause as { status?: number })?.status === 409) {
        setExpired(true);
        try { const latest = await fetchCredits(endpoint); onWallet(latest.wallet); } catch { /* The user can reopen after refreshing. */ }
      }
      setError(abort.signal.aborted ? zh ? '连接超时，请重试领取；同一天的奖励只会发放一次。' : 'Request timed out. Retry safely; each day is rewarded once.' : cause instanceof Error ? cause.message : zh ? '领取失败，请重试。' : 'Could not claim your reward. Please retry.');
    } finally { window.clearTimeout(timer); controller.current = null; setBusy(false); }
  }
  return <dialog ref={dialog} className={`credit-reward-dialog${result ? ' is-claimed' : ''}`} aria-labelledby="credit-reward-title" aria-describedby="credit-reward-description"
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }} onClick={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <div className="credit-reward-card">
      <button className="credit-reward-close" type="button" onClick={onClose} disabled={busy} aria-label={zh ? '关闭签到卡片' : 'Close reward card'}><X size={19} /></button>
      <div className="credit-reward-ribbon"><Sparkles size={13} />{zh ? '轻剪 · 每日签到礼包' : 'Qingjian · Daily gift'}</div>
      <p className="credit-reward-date">{day.replaceAll('-', '.')}</p>
      <div className="credit-reward-art" aria-hidden="true">
        <div className="credit-reward-halo" /><span className="credit-coin credit-coin-back"><Coins size={32} /></span>
        <span className="credit-coin credit-coin-front">{result ? <Check size={46} strokeWidth={2.6} /> : <Gift size={42} strokeWidth={1.7} />}</span>
        <Sparkles className="credit-art-spark one" size={21} /><Sparkles className="credit-art-spark two" size={15} />
        {result?.claimed ? <div className="credit-confetti">{sparks.map((spark, i) => <i key={i} style={{ '--spark-x': spark.x, '--spark-y': spark.y, '--spark-delay': spark.delay } as CSSProperties} />)}</div> : null}
      </div>
      <h2 id="credit-reward-title">{result ? result.claimed ? zh ? '今日灵感，已到账' : 'Your daily gift is here' : zh ? '今日奖励已领取' : 'Already claimed today' : zh ? '为今天的创作，添点灵感' : 'A little boost for your next idea'}</h2>
      <div className="credit-reward-value"><strong>{result?.claimed ? '+' : ''}{formatPoints(amount)}</strong><span>{zh ? '积分' : 'points'}</span></div>
      <p id="credit-reward-description">{result ? result.claimed ? zh ? '签到成功，积分已经加入你的余额。' : 'Check-in complete. Your balance has been updated.' : zh ? '这个礼包已经领过啦，余额已同步。' : 'This gift was already claimed. Your balance is up to date.' : zh ? '点击领取，收下今天的创作能量。' : 'Claim today’s gift and keep creating.'}</p>
      {error ? <p className="credit-reward-error" role="alert">{error}</p> : null}
      <button className="credit-primary" type="button" disabled={busy} onClick={() => result || expired ? onClose() : void claim()}>
        {result ? zh ? '收下礼包' : 'Enjoy your gift' : expired ? zh ? '返回积分页' : 'Back to credits' : busy ? zh ? '正在领取…' : 'Claiming…' : zh ? '领取积分' : 'Claim points'}{!busy ? <ArrowRight size={17} /> : null}
      </button>
      <small className="credit-reward-footnote">{zh ? '每日一份 · 积分可累计' : 'One gift each day · points roll over'}</small>
    </div>
  </dialog>;
}

export default function CreditPage({ wallet, endpoint, locale, onWallet }: { wallet: CreditWallet; endpoint: string; locale: string; onWallet: (wallet: CreditWallet) => void; }) {
  const zh = locale === 'zh-CN';
  const [history, setHistory] = useState<CreditHistory | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [reward, setReward] = useState<{ day: string; amount: number } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetchCredits(endpoint, controller.signal).then(next => { setHistory(next); setError(''); onWallet(next.wallet); }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '无法读取积分。'); });
    return () => controller.abort();
  }, [endpoint, wallet.balance, wallet.lastCheckInDate, onWallet]);
  async function more() {
    if (!history || busy) return;
    setBusy(true); setError('');
    try {
      const next = await fetchCredits(`${endpoint}?offset=${history.entries.length}`);
      setHistory(current => current ? { ...next, entries: [...current.entries, ...next.entries] } : next);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '无法读取积分。'); }
    finally { setBusy(false); }
  }
  return <section className="subpage-content credit-page">
    <div className="credit-balance-card">
      <div className="credit-balance-heading"><span><Coins size={17} />{zh ? '创作积分' : 'Creative credits'}</span>{wallet.special ? <small>{zh ? '特殊账户' : 'Special account'}</small> : null}</div>
      <div className="credit-balance"><strong>{formatPoints(wallet.balance)}</strong><span>{zh ? '积分' : 'points'}</span></div>
      <p>{zh ? '把灵感，变成下一支好视频。' : 'Turn your next idea into a great video.'}</p>
      <div className="credit-balance-foot"><span>{zh ? '1 积分 = ¥0.001' : '1 point = ¥0.001'}</span><span>{zh ? '累计使用' : 'Total used'} {formatPoints(wallet.totalSpent)}</span></div>
    </div>
    <section className={`credit-checkin${wallet.canCheckIn ? '' : ' is-done'}`} aria-labelledby="credit-checkin-title">
      <div className="credit-checkin-heading"><span className="credit-checkin-icon"><CalendarCheck2 size={22} /></span><div><h2 id="credit-checkin-title">{zh ? '每日签到' : 'Daily check-in'}</h2><p>{zh ? '每天一份，给创作充充电。' : 'A daily boost for your creativity.'}</p></div><span className="credit-day-badge">{wallet.checkInDate.slice(5).replace('-', '.')}</span></div>
      <div className="credit-checkin-reward"><Gift size={23} /><strong>+{formatPoints(wallet.dailyGrant)}</strong><span>{zh ? '积分' : 'points'}</span></div>
      <button className="credit-primary" type="button" disabled={!wallet.canCheckIn} onClick={() => setReward({ day: wallet.checkInDate, amount: wallet.dailyGrant })}>
        {wallet.canCheckIn ? zh ? '签到，开启今日礼包' : 'Check in · open today’s gift' : zh ? '今日已领取' : 'Claimed today'}{wallet.canCheckIn ? <ArrowRight size={17} /> : <Check size={17} />}
      </button>
      <p className="credit-checkin-hint">{wallet.canCheckIn ? zh ? '签到后点击领取，积分才会到账。' : 'Open your gift, then claim it to receive points.' : zh ? '明天 00:00（北京时间）再来领取。' : 'Next gift at 00:00 Beijing time tomorrow.'}</p>
    </section>
    <div className="credit-welcome"><span><Sparkles size={18} /></span><div><strong>{zh ? '新朋友的第一份礼物' : 'A welcome gift for new creators'}</strong><p>{zh ? `首次注册即获 ${formatPoints(wallet.registrationGrant)} 积分，自动到账。` : `New accounts receive ${formatPoints(wallet.registrationGrant)} points automatically.`}</p></div></div>
    <section className="credit-ledger" aria-labelledby="credit-ledger-title">
      <div className="credit-ledger-heading"><h2 id="credit-ledger-title">{zh ? '积分明细' : 'Credit history'}</h2><span>{zh ? '收支都清楚' : 'Every point accounted for'}</span></div>
      {error ? <p className="credit-page-error" role="alert">{error}</p> : null}
      {history ? <ul>{history.entries.map(entry => <li key={entry.id}>
        <span className={`credit-entry-icon${entry.points > 0 ? ' is-gift' : ''}`} aria-hidden="true">{entry.points > 0 ? <Gift size={17} /> : <Sparkles size={17} />}</span>
        <div><strong>{names[entry.kind]?.[zh ? 0 : 1] ?? entry.kind}</strong><time>{new Date(entry.at).toLocaleString(zh ? 'zh-CN' : 'en-US', { timeZone: 'Asia/Shanghai', hour12: false })}</time>{entry.usage ? <small>{zh ? '输入 / 输出 / 缓存' : 'Input / output / cached'}：{entry.usage.input} / {entry.usage.output} / {entry.usage.cachedInput} token</small> : null}</div>
        <span className={`credit-entry-amount${entry.points > 0 ? ' credit-plus' : ''}`}>{entry.points > 0 ? '+' : ''}{formatPoints(entry.points)}</span>
      </li>)}</ul> : <p className="credit-loading">{zh ? '正在读取积分明细…' : 'Loading your credit history…'}</p>}
      {history && history.entries.length < history.total ? <button className="credit-more" type="button" disabled={busy} onClick={() => void more()}>{busy ? '…' : zh ? '查看更多' : 'Load more'}</button> : null}
    </section>
    <p className="credit-policy">{zh ? '每天可领取一次，未签到的日期不补领，已领取积分可累计。模型按实际 token 用量扣分；积分不足时，已开始的任务仍会继续完成。' : 'Claim once each Beijing calendar day. Missed days cannot be claimed later; received points roll over. Actual model token usage is charged. Accepted tasks continue even when your balance runs out.'}</p>
    {reward ? <RewardCard day={reward.day} amount={reward.amount} zh={zh} endpoint={endpoint} onWallet={onWallet} onClose={() => setReward(null)} /> : null}
  </section>;
}
