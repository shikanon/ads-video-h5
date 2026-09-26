import { lazy, Suspense, useEffect, useState, type FormEvent } from 'react';
import { ArrowRight, Eye, EyeOff, ImagePlus, LockKeyhole, Mail, MessageCircle, Pause, Play, UserRound, Download } from 'lucide-react';
import type { PublicUser } from './types';
import './auth.css';

const Workspace = lazy(() => import('./App'));
type Screen = 'landing' | 'login' | 'register';
const apiPath = (url: string) => `${import.meta.env.BASE_URL.replace(/\/$/, '')}${url}`;
const heroImage = `${import.meta.env.BASE_URL}amalfi-coast-hero.jpg`;
const heroVideo = `${import.meta.env.BASE_URL}amalfi-coast-loop.mp4`;
function screenFromUrl(): Screen {
  return window.location.hash === '#/login' ? 'login' : window.location.hash === '#/register' ? 'register' : 'landing';
}

export default function Auth() {
  const [user, setUser] = useState<PublicUser | null | undefined>(undefined);
  const [screen, setScreen] = useState<Screen>(screenFromUrl);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [codePending, setCodePending] = useState(false);
  const [codeStatus, setCodeStatus] = useState('');
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [showPassword, setShowPassword] = useState(false);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const onHash = () => setScreen(screenFromUrl());
    window.addEventListener('hashchange', onHash);
    void fetch(apiPath('/api/auth/me')).then(async (response) => {
      setUser(response.ok ? (await response.json() as { user: PublicUser }).user : null);
    }).catch(() => setUser(null));
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => {
    if (resendAt <= Date.now()) return;
    const timer = window.setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= resendAt) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [resendAt]);
  const resendSeconds = Math.max(0, Math.ceil((resendAt - now) / 1000));
  function go(next: Screen) {
    setError('');
    setCodeStatus('');
    setScreen(next);
    const hash = next === 'landing' ? '' : `#/${next}`;
    window.history.pushState(null, '', `${window.location.pathname}${window.location.search}${hash}`);
    window.scrollTo({ top: 0, behavior: 'auto' });
  }
  async function sendCode() {
    if (codePending || resendSeconds > 0) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setError('请先填写有效的邮箱地址。'); return; }
    setCodePending(true); setError(''); setCodeStatus('');
    try {
      const response = await fetch(apiPath('/api/auth/send-code'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }),
      });
      const result = await response.json() as { ok?: boolean; error?: string; resendAfterSeconds?: number };
      if (!response.ok || !result.ok) throw new Error(result.error || '验证码发送失败，请稍后重试。');
      setCodeStatus('验证码已发送，请查看邮箱；10 分钟内有效。');
      setNow(Date.now());
      setResendAt(Date.now() + (result.resendAfterSeconds || 60) * 1000);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '网络中断，请重试。'); }
    finally { setCodePending(false); }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (screen === 'register' && password !== confirmPassword) { setError('两次输入的密码不一致。'); return; }
    setPending(true);
    setError('');
    try {
      const response = await fetch(apiPath(`/api/auth/${screen === 'register' ? 'register' : 'login'}`), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName, email, password, ...(screen === 'register' ? { verificationCode } : {}) }),
      });
      const result = await response.json() as { user?: PublicUser; error?: string };
      if (!response.ok || !result.user) throw new Error(result.error || '操作失败，请重试。');
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
      setPassword(''); setConfirmPassword(''); setVerificationCode('');
      setUser(result.user);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '网络中断，请重试。'); }
    finally { setPending(false); }
  }
  async function logout() {
    try {
      const response = await fetch(apiPath('/api/auth/logout'), { method: 'POST' });
      if (!response.ok) throw new Error('退出失败，请重试。');
      setUser(null);
      go('landing');
    } catch (cause) { window.alert(cause instanceof Error ? cause.message : '退出失败。'); }
  }
  if (user === undefined) return <div className="auth-loading"><span className="auth-logo">轻剪<span>.</span></span></div>;
  if (user) return <Suspense fallback={<div className="auth-loading"><span className="auth-logo">轻剪<span>.</span></span></div>}><Workspace key={user.id} user={user} onLogout={logout} /></Suspense>;
  return <div className="auth-page">
    <div className="auth-shell">
      <header className="auth-header">
        <button className="auth-logo" type="button" onClick={() => go('landing')} aria-label="轻剪首页">轻剪<span>.</span></button>
        {screen === 'landing' ? <button className="auth-header-link" type="button" onClick={() => go('login')}>登录 <ArrowRight size={16} /></button> : <button className="auth-header-link" type="button" onClick={() => go('landing')}>返回首页</button>}
      </header>
      {screen === 'landing' ? <main className="auth-landing">
        <div className="auth-hero-copy">
          <h1>一句话，<br /><span>剪出好视频。</span></h1>
          <p>添加你的素材，像聊天一样说出想法。轻剪帮你整理镜头、生成口播与配图，再把成片交到你手里。</p>
          <button className="auth-primary" type="button" onClick={() => go('register')}>开始创作 <ArrowRight size={20} /></button>
          <div className="auth-signin-hint">已有帐号？<button type="button" onClick={() => go('login')}>直接登录</button></div>
        </div>
        <div className="auth-hero-scene" aria-label="海岸旅行视频与对话剪辑示意">
          <div className={`auth-video-frame${previewPlaying ? ' is-playing' : ''}`}>
            <img src={heroImage} alt="阳光下的地中海海岸、蓝色海面与山间建筑" />
            {previewPlaying ? <video src={heroVideo} autoPlay muted loop playsInline poster={heroImage} onError={() => setPreviewPlaying(false)} aria-label="海岸与花朵旅行视频预览" /> : null}
            <button className="auth-play" type="button" onClick={() => setPreviewPlaying((value) => !value)} aria-label={previewPlaying ? '暂停视频预览' : '播放视频预览'}>{previewPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={22} fill="currentColor" />}</button>
            <span className="auth-video-caption">把旅行，剪成想分享的故事</span>
          </div>
          <div className="auth-bubble auth-bubble-one">帮我剪一支 15 秒旅行短片</div>
          <div className="auth-bubble auth-bubble-two">好的，先从最动人的镜头开始 ✦</div>
          <div className="auth-timeline" style={{ backgroundImage: `url(${heroImage})` }}><span /><span /><span /><span /></div>
        </div>
        <div className="auth-features"><div><MessageCircle size={22} /><strong>对话剪辑</strong><span>说出想法，持续调整</span></div><div><ImagePlus size={22} /><strong>口播与配图</strong><span>创作所需，一起完成</span></div><div><Download size={22} /><strong>成片下载</strong><span>预览确认，保存本地</span></div></div>
      </main> : <main className="auth-form-layout">
        <div className="auth-form-visual"><img src={heroImage} alt="阳光下的地中海海岸风景" /><div><span>轻剪.</span><p>好视频，从一句话开始。</p></div></div>
        <section className="auth-form-section">
          <div className="auth-form-intro"><h1>{screen === 'login' ? '欢迎回来' : '创建轻剪帐号'}</h1><p>{screen === 'login' ? '继续用对话，剪出好视频。' : '加入轻剪，开启你的创作之旅。'}</p></div>
          <form onSubmit={submit} className="auth-form">
            {screen === 'register' ? <label><span>显示名称</span><div className="auth-input"><UserRound size={19} /><input autoComplete="name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="怎么称呼你" required maxLength={40} /></div></label> : null}
            <label><span>邮箱地址</span><div className="auth-input"><Mail size={19} /><input type="email" autoComplete="email" value={email} onChange={(event) => { setEmail(event.target.value); setVerificationCode(''); setCodeStatus(''); setResendAt(0); }} placeholder="name@example.com" required maxLength={254} /></div></label>
            {screen === 'register' ? <label><span>邮箱验证码</span><div className="auth-code-row"><div className="auth-input"><Mail size={19} /><input value={verificationCode} onChange={(event) => setVerificationCode(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" placeholder="输入 6 位验证码" required maxLength={6} /></div><button type="button" onClick={() => void sendCode()} disabled={codePending || resendSeconds > 0}>{codePending ? '发送中…' : resendSeconds > 0 ? `${resendSeconds}s 后重发` : '发送验证码'}</button></div></label> : null}
            <label><span>密码</span><div className="auth-input"><LockKeyhole size={19} /><input type={showPassword ? 'text' : 'password'} autoComplete={screen === 'login' ? 'current-password' : 'new-password'} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={screen === 'register' ? '至少 10 位密码' : '输入密码'} required minLength={screen === 'register' ? 10 : undefined} /><button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? '隐藏密码' : '显示密码'}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div></label>
            {screen === 'register' ? <label><span>确认密码</span><div className="auth-input"><LockKeyhole size={19} /><input type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="再次输入密码" required minLength={10} /></div></label> : null}
            {codeStatus && screen === 'register' ? <p className="auth-code-status" role="status">{codeStatus}</p> : null}
            {error ? <p className="auth-error" role="alert">{error}</p> : null}
            <button className="auth-primary" type="submit" disabled={pending}>{pending ? '请稍候…' : screen === 'login' ? '登录' : '注册并开始'} <ArrowRight size={19} /></button>
          </form>
          <p className="auth-switch">{screen === 'login' ? '还没有帐号？' : '已有帐号？'} <button type="button" onClick={() => go(screen === 'login' ? 'register' : 'login')}>{screen === 'login' ? '注册帐号' : '登录'}</button></p>
          {screen === 'register' ? <p className="auth-form-note">素材与对话保存在轻剪服务端；生成请求会发送至所配置的模型服务。</p> : null}
        </section>
      </main>}
      <footer className="auth-footer"><span>轻剪 · 让创作更简单</span><span>© 2026 轻剪</span></footer>
    </div>
  </div>;
}
