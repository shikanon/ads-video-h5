import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, Check, KeyRound, Plus, Save, ShieldCheck, Trash2, X } from 'lucide-react';
import type { ModelKind } from './types';
import EffectAdmin from './EffectAdmin';

interface AdminModel {
  id: string;
  name: string;
  provider: string;
  kind: ModelKind;
  modelId: string;
  baseUrl: string;
  enabled: boolean;
  hasApiKey: boolean;
}

interface ModelForm {
  id: string | null;
  name: string;
  provider: string;
  kind: ModelKind;
  modelId: string;
  baseUrl: string;
  enabled: boolean;
  apiKey: string;
}

const blankForm = (): ModelForm => ({ id: null, name: '', provider: 'ark', kind: 'text', modelId: '', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', enabled: true, apiKey: '' });
const kindName: Record<ModelKind, string> = { text: '文本对话', image: '图片生成', audio: '口播音频' };
const tokenKey = 'qingjian-admin-token';
const apiPath = (url: string) => `${import.meta.env.BASE_URL.replace(/\/$/, '')}${url}`;

async function request<T>(url: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiPath(url), {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
  });
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error || '请求失败，请重试。');
  return data;
}

export default function Admin() {
  const [tokenInput, setTokenInput] = useState('');
  const [token, setToken] = useState(() => sessionStorage.getItem(tokenKey) || '');
  const [models, setModels] = useState<AdminModel[]>([]);
  const [defaultTextModelId, setDefaultTextModelId] = useState<string | null>(null);
  const [form, setForm] = useState<ModelForm>(blankForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [tab, setTab] = useState<'models' | 'effects'>('models');

  const load = useCallback(async (accessToken: string) => {
    const data = await request<{ models: AdminModel[]; defaultTextModelId: string | null }>('/api/admin/models', accessToken);
    setModels(data.models);
    setDefaultTextModelId(data.defaultTextModelId);
  }, []);

  useEffect(() => {
    if (!token) return;
    void load(token).catch((cause: unknown) => {
      const message = cause instanceof Error ? cause.message : '无法连接管理后台。';
      setError(message);
      if (message.includes('令牌')) {
        sessionStorage.removeItem(tokenKey);
        setToken('');
      }
    });
  }, [load, token]);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = tokenInput.trim();
    if (!value) return;
    setBusy(true);
    setError('');
    try {
      await load(value);
      sessionStorage.setItem(tokenKey, value);
      setToken(value);
      setTokenInput('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法验证令牌。');
    } finally {
      setBusy(false);
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const url = form.id ? `/api/admin/models/${form.id}` : '/api/admin/models';
      const method = form.id ? 'PUT' : 'POST';
      await request(url, token, { method, body: JSON.stringify({ ...form, apiKey: form.apiKey || undefined }) });
      await load(token);
      setForm(blankForm());
      setNotice('模型配置已保存。');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败。');
    } finally {
      setBusy(false);
    }
  }

  async function remove(model: AdminModel) {
    if (!window.confirm(`确定删除「${model.name}」？使用它的生成任务可能无法重试。`)) return;
    setBusy(true);
    setError('');
    try {
      await request(`/api/admin/models/${model.id}`, token, { method: 'DELETE' });
      await load(token);
      if (form.id === model.id) setForm(blankForm());
      setNotice('模型已删除。');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '删除失败。');
    } finally {
      setBusy(false);
    }
  }

  async function makeDefault(model: AdminModel) {
    setBusy(true);
    setError('');
    try {
      await request('/api/admin/default-text-model', token, { method: 'PUT', body: JSON.stringify({ id: model.id }) });
      setDefaultTextModelId(model.id);
      setNotice(`「${model.name}」已设为新对话的默认模型。`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '设置失败。');
    } finally {
      setBusy(false);
    }
  }

  function edit(model: AdminModel) {
    setForm({ id: model.id, name: model.name, provider: model.provider, kind: model.kind, modelId: model.modelId, baseUrl: model.baseUrl, enabled: model.enabled, apiKey: '' });
    setNotice('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return (
    <div className="admin-page">
      <header className="admin-topbar">
        <a href={import.meta.env.BASE_URL} className="admin-back"><ArrowLeft size={18} /> 返回轻剪</a>
        <div className="admin-brand">轻剪<span>.</span> <small>管理后台</small></div>
        {token ? <button type="button" className="admin-signout" onClick={() => { sessionStorage.removeItem(tokenKey); setToken(''); setModels([]); }}>退出管理</button> : <span />}
      </header>

      {!token ? (
        <main className="admin-login">
          <div className="admin-login-icon"><KeyRound size={28} /></div>
          <h1>管理后台</h1>
          <p>在这里维护厂商模型、API Key 和 HTML 视频特效。密钥只保存在服务端。</p>
          <form onSubmit={(event) => void signIn(event)}>
            <label htmlFor="admin-token">管理员令牌</label>
            <input id="admin-token" type="password" autoComplete="off" value={tokenInput} onChange={(event) => setTokenInput(event.target.value)} placeholder="输入本地管理员令牌" required />
            <button type="submit" disabled={busy || !tokenInput.trim()}>{busy ? '验证中…' : '进入管理后台'}</button>
          </form>
          <p className="admin-login-help">管理员令牌保存在服务端数据目录的 <code>admin-token</code> 文件中。</p>
          {error ? <div className="admin-alert" role="alert">{error}</div> : null}
        </main>
      ) : (
        <main className="admin-layout">
          <nav className="admin-tabs" aria-label="管理功能"><button type="button" className={tab === 'models' ? 'is-active' : ''} onClick={() => setTab('models')}>模型与密钥</button><button type="button" className={tab === 'effects' ? 'is-active' : ''} onClick={() => setTab('effects')}>HTML 视频特效</button></nav>
          {tab === 'effects' ? <EffectAdmin token={token} /> : <>
          <div className="admin-heading"><div><h1>模型与密钥</h1><p>配置对话、图片和口播模型。新密钥保存后仅显示配置状态。</p></div><ShieldCheck size={28} /></div>
          {error ? <div className="admin-alert" role="alert">{error}<button onClick={() => setError('')} aria-label="关闭错误"><X size={16} /></button></div> : null}
          {notice ? <div className="admin-notice" role="status"><Check size={16} />{notice}</div> : null}
          <div className="admin-columns">
            <section className="admin-panel admin-editor">
              <div className="admin-panel-heading"><h2>{form.id ? '编辑模型' : '添加模型'}</h2>{form.id ? <button type="button" onClick={() => setForm(blankForm())}>取消编辑</button> : null}</div>
              <form onSubmit={(event) => void save(event)}>
                <div className="admin-form-grid">
                  <label>显示名称<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="例如 豆包 Seed 2.1 Pro" required maxLength={80} /></label>
                  <label>用途<select value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value as ModelKind })}><option value="text">文本对话</option><option value="image">图片生成</option><option value="audio">口播音频</option></select></label>
                  <label>厂商或适配器<input value={form.provider} onChange={(event) => setForm({ ...form, provider: event.target.value })} placeholder="ark / volcengine-voice" required maxLength={80} /></label>
                  <label>模型 ID<input value={form.modelId} onChange={(event) => setForm({ ...form, modelId: event.target.value })} placeholder="填写厂商提供的模型 ID" required maxLength={160} /></label>
                  <label className="admin-wide">服务地址<input value={form.baseUrl} onChange={(event) => setForm({ ...form, baseUrl: event.target.value })} placeholder="https://..." type="url" /></label>
                  <label className="admin-wide">API Key<input value={form.apiKey} onChange={(event) => setForm({ ...form, apiKey: event.target.value })} type="password" autoComplete="new-password" placeholder={form.id ? '留空表示保持原密钥' : '输入厂商 API Key'} /></label>
                </div>
                <label className="admin-toggle"><input type="checkbox" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} /> 启用此模型</label>
                <button className="admin-save" type="submit" disabled={busy}><Save size={17} />{busy ? '保存中…' : '保存模型'}</button>
              </form>
            </section>
            <section className="admin-panel admin-model-list">
              <div className="admin-panel-heading"><h2>已配置模型</h2><span>{models.length} 个</span></div>
              {models.length ? models.map((model) => (
                <article className="admin-model" key={model.id}>
                  <div className="admin-model-title"><strong>{model.name}</strong><span className={model.enabled && model.hasApiKey ? 'admin-ready' : 'admin-muted'}>{model.enabled ? model.hasApiKey ? '可用' : '待填密钥' : '已停用'}</span></div>
                  <p>{kindName[model.kind]} · {model.provider}</p>
                  <code>{model.modelId}</code>
                  <div className="admin-model-actions">
                    {model.kind === 'text' && model.enabled && model.hasApiKey ? <button type="button" disabled={busy || defaultTextModelId === model.id} onClick={() => void makeDefault(model)}>{defaultTextModelId === model.id ? '当前默认' : '设为默认'}</button> : null}
                    <button type="button" onClick={() => edit(model)}>编辑</button>
                    <button type="button" className="admin-delete" onClick={() => void remove(model)} aria-label={`删除 ${model.name}`}><Trash2 size={16} /></button>
                  </div>
                </article>
              )) : <div className="admin-empty"><Plus size={22} /><p>还没有模型配置</p></div>}
            </section>
          </div>
          </>}
        </main>
      )}
    </div>
  );
}
