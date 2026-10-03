import { useState, type FormEvent } from 'react';
import { Check, Download, ShieldCheck } from 'lucide-react';
import type { AdminAccount, AdminLogin, AdminTotpSetup } from '../../../shared/adminAuthTypes';
import { api } from './api';
import './security.css';

type CredentialResult = AdminLogin & { recoveryCodes?: string[] };

export default function AccountSecurity({ token, account, onLogin }: { token: string; account: AdminAccount; onLogin: (login: AdminLogin) => void }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordCode, setPasswordCode] = useState('');
  const [verificationPassword, setVerificationPassword] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [setup, setSetup] = useState<AdminTotpSetup | null>(null);
  const [setupCode, setSetupCode] = useState('');
  const [codes, setCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  function updated(result: CredentialResult, message: string) {
    onLogin(result); setSetup(null); setSetupCode(''); setVerificationPassword(''); setVerificationCode(''); setCodes(result.recoveryCodes || []); setNotice(message);
  }
  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setNotice('');
    if (newPassword !== confirmPassword) { setError('两次新密码不一致。'); return; }
    setBusy(true);
    try {
      const result = await api<AdminLogin>('/api/admin/auth/password', token, { method: 'PUT', body: JSON.stringify({ password: currentPassword, newPassword, code: passwordCode }) });
      updated(result, '密码已更新，其他登录会话已退出。'); setCurrentPassword(''); setNewPassword(''); setConfirmPassword(''); setPasswordCode('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '密码更新失败。'); }
    finally { setBusy(false); }
  }
  async function createSetup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const result = await api<AdminTotpSetup>('/api/admin/auth/totp/setup', token, { method: 'POST', body: JSON.stringify({ password: verificationPassword }) });
      setSetup(result); setSetupCode(''); setVerificationPassword(''); setCodes([]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '无法生成绑定二维码。'); }
    finally { setBusy(false); }
  }
  async function enableTotp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const result = await api<CredentialResult>('/api/admin/auth/totp/enable', token, { method: 'POST', body: JSON.stringify({ code: setupCode }) });
      updated(result, 'Authenticator 已绑定。下次登录需要动态验证码，请保存下面的恢复码。');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '绑定失败，请重试。'); }
    finally { setBusy(false); }
  }
  async function manageTotp(action: 'disable' | 'recovery-codes') {
    if (!verificationPassword || !verificationCode) { setError('请填写当前密码和动态验证码或恢复码。'); return; }
    if (!window.confirm(action === 'disable' ? '关闭后，登录将只验证账号密码。确定关闭 Authenticator？' : '重新生成后，之前保存的所有恢复码将立即失效。确定继续？')) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await api<CredentialResult>(action === 'disable' ? '/api/admin/auth/totp/disable' : '/api/admin/auth/recovery-codes', token, { method: 'POST', body: JSON.stringify({ password: verificationPassword, code: verificationCode }) });
      updated(result, action === 'disable' ? 'Authenticator 已关闭，其他登录会话已退出。' : '恢复码已重新生成，旧恢复码和其他登录会话已失效。');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '操作失败，请重试。'); }
    finally { setBusy(false); }
  }
  function downloadCodes() {
    const blob = new Blob([`轻剪管理员 admin 恢复码\n生成时间：${new Date().toLocaleString()}\n每个恢复码只能使用一次，请妥善保存。\n\n${codes.join('\n')}\n`], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = 'qingjian-admin-recovery-codes.txt'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section className="admin-security">
    <div className="admin-heading"><div><h1>账号安全</h1><p>管理员账号 admin · 密码与 Authenticator 双重验证</p></div><ShieldCheck size={28} /></div>
    {account.mustChangePassword ? <div className="admin-security-first" role="status">首次登录：请先设置自己的密码，完成后即可使用管理功能和绑定 Authenticator。</div> : null}
    {error ? <div className="admin-alert" role="alert">{error}</div> : null}
    {notice ? <div className="admin-notice" role="status"><Check size={16} />{notice}</div> : null}
    <div className="admin-security-columns">
      <section className="admin-panel">
        <div className="admin-panel-heading"><h2>{account.mustChangePassword ? '设置管理员密码' : '修改密码'}</h2></div>
        <form className="admin-security-form" onSubmit={event => void changePassword(event)}>
          <label>当前密码<input type="password" autoComplete="current-password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} maxLength={256} required /></label>
          <label>新密码<input type="password" autoComplete="new-password" value={newPassword} onChange={event => setNewPassword(event.target.value)} minLength={12} maxLength={256} placeholder="至少 12 位" required /></label>
          <label>确认新密码<input type="password" autoComplete="new-password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} minLength={12} maxLength={256} required /></label>
          {account.totpEnabled ? <label>动态验证码或恢复码<input autoComplete="one-time-code" value={passwordCode} onChange={event => setPasswordCode(event.target.value)} maxLength={14} required /></label> : null}
          <button className="admin-save" type="submit" disabled={busy}>{busy ? '处理中…' : '保存密码'}</button>
        </form>
      </section>
      <section className="admin-panel">
        <div className="admin-panel-heading"><h2>Authenticator 动态验证码</h2><span className={account.totpEnabled ? 'admin-ready' : 'admin-muted'}>{account.totpEnabled ? '已启用' : '未绑定'}</span></div>
        <p className="admin-security-help">支持 Google Authenticator、Microsoft Authenticator 等应用。扫码后输入 6 位动态验证码完成绑定。</p>
        {account.mustChangePassword ? <p className="admin-security-help">设置管理员密码后可开始绑定。</p> : setup ? <>
          <div className="admin-totp-qr"><img src={setup.qrDataUrl} alt="轻剪管理员 Authenticator 绑定二维码" width={256} height={256} /></div>
          <details className="admin-totp-manual"><summary>无法扫码？手动输入密钥</summary><code>{setup.secret}</code><p>账号：轻剪：admin · 6 位 · 每 30 秒更新</p></details>
          <form className="admin-security-form" onSubmit={event => void enableTotp(event)}>
            <label>Authenticator 动态验证码<input autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} placeholder="6 位动态验证码" value={setupCode} onChange={event => setSetupCode(event.target.value)} required /></label>
            <div className="admin-security-actions"><button className="admin-save" type="submit" disabled={busy}>确认绑定</button><button className="admin-security-secondary" type="button" disabled={busy} onClick={() => { setSetup(null); setSetupCode(''); }}>取消</button></div>
          </form>
          <p className="admin-security-help">二维码有效期 10 分钟。密钥仅用于绑定，请保密。</p>
        </> : !account.totpEnabled ? <form className="admin-security-form" onSubmit={event => void createSetup(event)}>
          <label>验证当前密码<input type="password" autoComplete="current-password" value={verificationPassword} onChange={event => setVerificationPassword(event.target.value)} maxLength={256} required /></label>
          <button className="admin-save" type="submit" disabled={busy}>生成绑定二维码</button>
        </form> : <form className="admin-security-form" onSubmit={event => { event.preventDefault(); void manageTotp('recovery-codes'); }}>
          <p className="admin-security-help">剩余恢复码：{account.recoveryCodesRemaining} 个。更换设备或重新生成恢复码前，请验证当前身份。</p>
          <label>验证当前密码<input type="password" autoComplete="current-password" value={verificationPassword} onChange={event => setVerificationPassword(event.target.value)} maxLength={256} required /></label>
          <label>动态验证码或恢复码<input autoComplete="one-time-code" value={verificationCode} onChange={event => setVerificationCode(event.target.value)} maxLength={14} required /></label>
          <div className="admin-security-actions"><button className="admin-save" type="submit" disabled={busy}>重新生成恢复码</button><button className="admin-security-secondary admin-security-danger" type="button" disabled={busy} onClick={() => void manageTotp('disable')}>关闭动态验证码</button></div>
        </form>}
      </section>
    </div>
    {codes.length ? <section className="admin-panel admin-recovery" aria-label="一次性恢复码">
      <div className="admin-panel-heading"><h2>保存一次性恢复码</h2><button type="button" onClick={downloadCodes}><Download size={15} /> 下载恢复码</button></div>
      <p className="admin-security-help">恢复码只显示这一次。手机丢失时，用它代替动态验证码登录；每个只能使用一次。</p>
      <div className="admin-recovery-grid">{codes.map(code => <code key={code}>{code}</code>)}</div>
      <button className="admin-security-secondary" type="button" onClick={() => setCodes([])}>我已保存，隐藏恢复码</button>
    </section> : null}
  </section>;
}
