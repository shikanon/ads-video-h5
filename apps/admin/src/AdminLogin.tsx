import { useState, type FormEvent } from 'react';
import { ArrowLeft, KeyRound, ShieldCheck } from 'lucide-react';
import type { AdminChallenge, AdminLogin as LoginResult } from '../../../shared/adminAuthTypes';
import { api } from './api';

export default function AdminLogin({ onLogin, notice = '' }: { onLogin: (login: LoginResult) => void; notice?: string }) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [challenge, setChallenge] = useState<AdminChallenge | null>(null);
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      if (challenge && challenge.expiresAt <= Date.now()) { setChallenge(null); setCode(''); throw new Error('验证已过期，请重新输入密码。'); }
      const result = challenge
        ? await api<LoginResult>('/api/admin/auth/login/totp', '', { method: 'POST', body: JSON.stringify({ challenge: challenge.challenge, code }) })
        : await api<LoginResult | AdminChallenge>('/api/admin/auth/login', '', { method: 'POST', body: JSON.stringify({ username: username.trim(), password }) });
      setPassword('');
      if ('requiresTotp' in result) { setChallenge(result); setCode(''); }
      else { setChallenge(null); setCode(''); onLogin(result); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : '登录失败，请重试。'); }
    finally { setBusy(false); }
  }

  return <main className="admin-login">
    <div className="admin-login-icon">{challenge ? <ShieldCheck size={28} /> : <KeyRound size={28} />}</div>
    <h1>{challenge ? '验证你的身份' : '管理员登录'}</h1>
    <p>{challenge ? recovery ? '输入绑定时保存的一次性恢复码。每个恢复码仅可使用一次。' : '打开 Authenticator，输入「轻剪：admin」的 6 位动态验证码。' : '使用管理员账号管理模型、HTML 视频特效和 Agent 评测。'}</p>
    {notice && !challenge ? <div className="admin-notice" role="status">{notice}</div> : null}
    <form onSubmit={event => void signIn(event)}>
      {challenge ? <>
        <label htmlFor="admin-otp">{recovery ? '恢复码' : 'Authenticator 动态验证码'}</label>
        <input key={recovery ? 'recovery' : 'otp'} id="admin-otp" autoFocus autoComplete="one-time-code" inputMode={recovery ? 'text' : 'numeric'} pattern={recovery ? undefined : '[0-9]{6}'} maxLength={recovery ? 14 : 6} value={code} onChange={event => setCode(event.target.value)} placeholder={recovery ? 'XXXX-XXXX-XXXX' : '6 位动态验证码'} required />
      </> : <>
        <label htmlFor="admin-username">账号</label>
        <input id="admin-username" autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} maxLength={80} required />
        <label htmlFor="admin-password">密码</label>
        <input id="admin-password" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} maxLength={256} placeholder="输入管理员密码" required />
      </>}
      <button type="submit" disabled={busy}>{busy ? '验证中…' : challenge ? '验证并登录' : '登录管理后台'}</button>
    </form>
    {challenge ? <div className="admin-login-links">
      <button type="button" disabled={busy} onClick={() => { setRecovery(!recovery); setCode(''); setError(''); }}>{recovery ? '使用动态验证码' : '无法使用 Authenticator？使用恢复码'}</button>
      <button type="button" disabled={busy} onClick={() => { setChallenge(null); setCode(''); setError(''); }}><ArrowLeft size={14} /> 返回账号登录</button>
    </div> : <p className="admin-login-help">默认账号为 admin。初始密码由服务器生成，首次登录后需设置自己的密码。</p>}
    {error ? <div className="admin-alert" role="alert">{error}</div> : null}
  </main>;
}
