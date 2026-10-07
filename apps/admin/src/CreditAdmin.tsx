import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { CreditAdminState, CreditAccount, CreditEntry, CreditWallet, TokenPrice } from '../../../shared/creditTypes';
import { formatPoints } from '../../../shared/creditFormat';
import { api } from './api';
import './credits.css';

interface Ledger { wallet: CreditWallet; entries: CreditEntry[]; total: number; }
const labels = { signup_grant: '注册赠送', daily_checkin: '每日签到', daily_grant: '每日赠送', special_grant: '特殊账户额度', model_usage: '模型调用', usage_pending: '用量待核对' };
const priceFields = { input: '输入', cachedInput: '缓存输入', output: '输出', audioInput: '音频输入', cachedAudioInput: '缓存音频输入' } as const;
export default function CreditAdmin({ token }: { token: string }) {
  const [state, setState] = useState<CreditAdminState | null>(null), [search, setSearch] = useState(''), [form, setForm] = useState<TokenPrice | null>(null);
  const [selected, setSelected] = useState<CreditAccount | null>(null), [ledger, setLedger] = useState<Ledger | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const load = useCallback(async (signal?: AbortSignal) => setState(await api<CreditAdminState>('/api/admin/credits', token, { signal })), [token]);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '积分设置无法加载。'); });
    return () => controller.abort();
  }, [load]);
  async function special(account: CreditAccount) {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await api<{ wallet: CreditWallet }>(`/api/admin/credits/users/${account.id}`, token, { method: 'PATCH', body: JSON.stringify({ special: !account.wallet.special }) });
      setState(current => current ? { ...current, accounts: current.accounts.map(a => a.id === account.id ? { ...a, wallet: result.wallet } : a) } : current);
      setNotice(result.wallet.special ? '已设为特殊账户。初始额度只发放一次，历史消费保留。' : '已取消特殊账户，已有积分与消费记录保留。');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '设置失败。'); }
    finally { setBusy(false); }
  }
  async function records(account: CreditAccount, more = false) {
    setBusy(true); setError('');
    try {
      const result = await api<Ledger>(`/api/admin/credits/users/${account.id}/ledger?offset=${more ? ledger?.entries.length ?? 0 : 0}`, token);
      setSelected(account); setLedger(previous => more && previous ? { ...result, entries: [...previous.entries, ...result.entries] } : result);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '读取失败。'); }
    finally { setBusy(false); }
  }
  async function save(event: FormEvent) {
    event.preventDefault(); if (!form) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await api(`/api/admin/credits/prices/${encodeURIComponent(form.modelId)}`, token, { method: 'PUT', body: JSON.stringify(form) });
      await load(); setForm(null); setNotice('模型价格已保存，将用于之后发起的模型调用。历史扣费保持原价格。');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败。'); }
    finally { setBusy(false); }
  }
  return <div className="credit-admin">
    <div className="admin-heading"><div><h1>用户与积分</h1><p>注册赠送 {formatPoints(state?.registrationGrant ?? 2000)} · 每日签到领取 {formatPoints(state?.dailyGrant ?? 1000)} 积分 · 1 积分 = ¥0.001</p></div></div>
    <p className="credit-admin-policy">特殊账户初始额度 {formatPoints(state?.specialInitial ?? 1000000)} 积分。余额 ≤ 0 时拦截新指令；已接收任务继续执行，可产生负余额。每天按北京时间签到并领取一次，未签到的日期不补领；已领取积分可累计。</p>
    {error ? <div className="admin-alert" role="alert">{error}</div> : null}
    {notice ? <div className="admin-notice" role="status">{notice}</div> : null}
    <section className="admin-panel">
      <div className="admin-panel-heading"><h2>用户账户</h2><input className="credit-search" aria-label="搜索用户" placeholder="搜索邮箱、昵称或用户 ID" value={search} onChange={e => setSearch(e.target.value)} /></div>
      <div className="credit-table-wrap"><table><thead><tr><th>用户</th><th>积分余额</th><th>累计消费</th><th>特殊账户</th><th>记录</th></tr></thead><tbody>
        {state?.accounts.filter(a => `${a.email} ${a.displayName} ${a.id}`.toLowerCase().includes(search.toLowerCase())).map(a => <tr key={a.id}>
          <td><strong>{a.displayName}</strong><small>{a.authProvider === 'wechat' ? '微信账号' : a.email}</small><small>{a.id}</small></td><td className={a.wallet.balance <= 0 ? 'credit-negative' : ''}>{formatPoints(a.wallet.balance)}</td><td>{formatPoints(a.wallet.totalSpent)}</td>
          <td><input type="checkbox" aria-label={`${a.displayName} 特殊账户`} checked={a.wallet.special} disabled={busy} onChange={() => void special(a)} /></td><td><button type="button" disabled={busy} onClick={() => void records(a)}>查看</button></td>
        </tr>)}
      </tbody></table></div>{!state ? <p>正在读取账户…</p> : null}
    </section>
    {selected && ledger ? <section className="admin-panel">
      <div className="admin-panel-heading"><h2>{selected.displayName} · 积分记录</h2><button type="button" onClick={() => { setSelected(null); setLedger(null); }}>关闭记录</button></div>
      <div className="credit-table-wrap"><table><thead><tr><th>时间 / 类型</th><th>积分</th><th>余额</th><th>用量与价格</th></tr></thead><tbody>{ledger.entries.map(e => <tr key={e.id}>
        <td>{new Date(e.at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}<small>{labels[e.kind]}</small></td><td>{e.points > 0 ? '+' : ''}{formatPoints(e.points)}</td><td>{formatPoints(e.balance)}</td>
        <td>{e.modelId ? <code>{e.modelId}</code> : null}{e.usage ? <small>输入 {e.usage.input} / 输出 {e.usage.output} / 缓存 {e.usage.cachedInput}{e.usage.audioInput ? ` / 音频 ${e.usage.audioInput}` : ''} token</small> : null}{e.price ? <small>输入 ¥{e.price.input} / 缓存 ¥{e.price.cachedInput} / 输出 ¥{e.price.output} 每百万 token</small> : null}{e.detail ? <small>{e.detail}</small> : null}</td>
      </tr>)}</tbody></table></div>
      {ledger.entries.length < ledger.total ? <button type="button" disabled={busy} onClick={() => void records(selected, true)}>更多记录</button> : null}
    </section> : null}
    <section className="admin-panel">
      <div className="admin-panel-heading"><h2>模型 token 价格</h2><a href="https://docs.volcengine.com/docs/ark/model-pricing?lang=zh" target="_blank" rel="noreferrer">官方价格参考</a></div>
      <p>单位：元 / 百万 token，普通在线推理。每次调用按供应商返回的实际用量扣分，输出用量包含推理 token。缺少用量会记录为待核对。</p>
      <div className="credit-table-wrap"><table><thead><tr><th>模型</th><th>输入</th><th>缓存输入</th><th>输出</th><th>操作</th></tr></thead><tbody>{state?.prices.map(p => <tr key={p.modelId}>
        <td><code>{p.modelId}</code>{p.audioInput !== undefined ? <small>音频输入 ¥{p.audioInput} / 缓存 ¥{p.cachedAudioInput ?? '待配置'}</small> : null}</td><td>¥{p.input}</td><td>¥{p.cachedInput}</td><td>¥{p.output}</td><td><button type="button" onClick={() => setForm(p)}>编辑价格</button></td>
      </tr>)}</tbody></table></div>
      <button type="button" onClick={() => setForm({ modelId: '', input: 0, cachedInput: 0, output: 0, source: '', updatedAt: '' })}>添加模型价格</button>
      {form ? <form className="credit-price-form" onSubmit={e => void save(e)}>
        <label>模型 ID<input required value={form.modelId} maxLength={160} onChange={e => setForm({ ...form, modelId: e.target.value })} /></label>
        {Object.entries(priceFields).map(([key, label]) => <label key={key}>{label}<input type="number" required={key === 'input' || key === 'cachedInput' || key === 'output'} min="0" max="100000" step="0.001" value={form[key as keyof typeof priceFields] ?? ''} onChange={e => setForm({ ...form, [key]: e.target.value === '' ? undefined : Number(e.target.value) })} /></label>)}
        <button className="admin-save" disabled={busy} type="submit">保存价格</button><button type="button" onClick={() => setForm(null)}>取消</button>
      </form> : null}
    </section>
  </div>;
}
