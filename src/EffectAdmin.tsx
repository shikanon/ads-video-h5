import { useEffect, useState, type FormEvent } from 'react';
import { Clapperboard, Copy, Download, Eye, Film, Plus, Save, Trash2 } from 'lucide-react';

type Values = { eyebrow: string; title: string; subtitle: string; imageUrl: string; accent: string };
type Effect = { id: string; name: string; description: string; html: string; duration: number; width: number; height: number; enabled: boolean; defaults: Values; createdAt: string; updatedAt: string };
type Render = { id: string; effectId: string; status: 'queued' | 'running' | 'succeeded' | 'failed'; error?: string; downloadUrl?: string };
const pathFor = (url: string) => `${import.meta.env.BASE_URL.replace(/\/$/, '')}${url}`;
async function api<T>(url: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(pathFor(url), { ...init, headers: { Authorization: `Bearer ${token}`, ...(init?.body ? { 'Content-Type': 'application/json' } : {}) } });
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error || '请求失败。');
  return data;
}
const defaultValues: Values = { eyebrow: '轻剪 · YOUR STORY', title: '去看更大的世界', subtitle: '把今天，剪成值得收藏的片段。', imageUrl: '', accent: '#fb7353' };

export default function EffectAdmin({ token }: { token: string }) {
  const [effects, setEffects] = useState<Effect[]>([]);
  const [form, setForm] = useState<Effect | null>(null);
  const [values, setValues] = useState<Values>(defaultValues);
  const [preview, setPreview] = useState('');
  const [render, setRender] = useState<Render | null>(null);
  const [renders, setRenders] = useState<Render[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function load() {
    const result = await api<{ effects: Effect[] }>('/api/admin/effects', token);
    setEffects(result.effects);
    setForm((current) => current ? result.effects.find((item) => item.id === current.id) || current : result.effects[0] || null);
    setRenders((await api<{ renders: Render[] }>('/api/admin/effects/renders', token)).renders);
  }
  useEffect(() => { void load().catch((cause) => setError(cause instanceof Error ? cause.message : '特效库加载失败。')); }, [token]);
  useEffect(() => {
    if (!render || (render.status !== 'running' && render.status !== 'queued')) return;
    const timer = window.setInterval(async () => {
      try { const result = await api<{ render: Render }>(`/api/admin/effects/renders/${render.id}`, token); setRender(result.render); setRenders((current) => current.map((item) => item.id === result.render.id ? result.render : item)); }
      catch (cause) { setError(cause instanceof Error ? cause.message : '无法读取渲染状态。'); }
    }, 1400);
    return () => window.clearInterval(timer);
  }, [render?.id, render?.status, token]);

  function select(effect: Effect) { setForm({ ...effect, defaults: { ...effect.defaults } }); setValues({ ...effect.defaults }); setPreview(''); setRender(null); setError(''); setNotice(''); }
  function update(key: keyof Effect, value: Effect[keyof Effect]) { if (form) setForm({ ...form, [key]: value }); }
  function updateDefault(key: keyof Values, value: string) { if (form) setForm({ ...form, defaults: { ...form.defaults, [key]: value } }); }
  function duplicate() {
    const base = form || effects[0]; if (!base) return;
    select({ ...base, id: '', name: `${base.name} · 副本`, createdAt: '', updatedAt: '' });
    setNotice('已复制为新模板，编辑后保存。');
  }
  async function save(event: FormEvent) {
    event.preventDefault(); if (!form) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await api<{ effect: Effect }>(form.id ? `/api/admin/effects/${form.id}` : '/api/admin/effects', token, { method: form.id ? 'PUT' : 'POST', body: JSON.stringify(form) });
      const list = await api<{ effects: Effect[] }>('/api/admin/effects', token);
      setEffects(list.effects); select(result.effect); setNotice('HTML 特效已保存。');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败。'); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!form?.id || !window.confirm(`删除「${form.name}」？`)) return;
    setBusy(true); setError('');
    try { await api(`/api/admin/effects/${form.id}`, token, { method: 'DELETE' }); const list = await api<{ effects: Effect[] }>('/api/admin/effects', token); setEffects(list.effects); setForm(list.effects[0] || null); setPreview(''); setNotice('特效已删除。'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '删除失败。'); }
    finally { setBusy(false); }
  }
  async function showPreview() {
    if (!form) return; setBusy(true); setError('');
    try { const result = await api<{ html: string }>('/api/admin/effects/preview-draft', token, { method: 'POST', body: JSON.stringify({ effect: form, values }) }); setPreview(result.html); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '预览失败。'); }
    finally { setBusy(false); }
  }
  async function startRender() {
    if (!form?.id) return; setBusy(true); setError(''); setNotice('');
    try { const result = await api<{ render: Render }>(`/api/admin/effects/${form.id}/render`, token, { method: 'POST', body: JSON.stringify({ values }) }); setRender(result.render); setRenders((current) => [result.render, ...current]); setNotice('渲染已开始，完成后可下载 MP4。'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '渲染失败。'); }
    finally { setBusy(false); }
  }
  async function download(item: Render) {
    if (!item.downloadUrl) return;
    try {
      const response = await fetch(pathFor(item.downloadUrl), { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error('视频下载失败。');
      const blobUrl = URL.createObjectURL(await response.blob()); const link = document.createElement('a'); link.href = blobUrl; link.download = `${effects.find((effect) => effect.id === item.effectId)?.name || '轻剪特效'}.mp4`; link.click(); window.setTimeout(() => URL.revokeObjectURL(blobUrl), 30_000);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '下载失败。'); }
  }
  const scale = form?.width === 1920 ? 0.14 : 0.25;
  return <div className="effects-admin">
    <div className="admin-heading"><div><h1>HTML 视频特效库</h1><p>Write HTML. Render video · 用组件编排时间轴，预览后渲染为 MP4。</p></div><Clapperboard size={28} /></div>
    {error ? <div className="admin-alert" role="alert">{error}</div> : null}
    {notice ? <div className="admin-notice" role="status">{notice}</div> : null}
    <div className="effects-workspace">
      <aside className="admin-panel effects-list"><div className="admin-panel-heading"><h2>特效模板</h2><span>{effects.length} 个</span></div>{effects.map((item) => <button type="button" key={item.id} className={`effects-list-item ${form?.id === item.id ? 'is-selected' : ''}`} onClick={() => select(item)}><span>{item.name}</span><small>{item.duration} 秒 · {item.enabled ? '已启用' : '已停用'}</small></button>)}<button type="button" className="effects-add" onClick={duplicate}><Plus size={16} /> 从当前模板新建</button></aside>
      {form ? <div className="effects-main">
        <section className="admin-panel"><div className="admin-panel-heading"><h2>{form.id ? '编辑特效' : '新建特效'}</h2><div className="effects-inline-actions"><button type="button" onClick={duplicate}><Copy size={15} /> 复制</button>{form.id ? <button type="button" onClick={() => void remove()}><Trash2 size={15} /> 删除</button> : null}</div></div>
          <form onSubmit={(event) => void save(event)}><div className="admin-form-grid"><label>名称<input value={form.name} onChange={(event) => update('name', event.target.value)} maxLength={80} required /></label><label>时长（秒）<input type="number" min="1" max="15" step="0.1" value={form.duration} onChange={(event) => update('duration', Number(event.target.value))} /></label><label className="admin-wide">用途说明<input value={form.description} onChange={(event) => update('description', event.target.value)} maxLength={240} /></label><label>画面宽度<input type="number" value={form.width} onChange={(event) => update('width', Number(event.target.value))} /></label><label>画面高度<input type="number" value={form.height} onChange={(event) => update('height', Number(event.target.value))} /></label><label>默认标题<input value={form.defaults.title} onChange={(event) => updateDefault('title', event.target.value)} maxLength={60} /></label><label>默认副标题<input value={form.defaults.subtitle} onChange={(event) => updateDefault('subtitle', event.target.value)} maxLength={120} /></label><label>默认眉题<input value={form.defaults.eyebrow} onChange={(event) => updateDefault('eyebrow', event.target.value)} /></label><label>主题色<input type="color" value={form.defaults.accent} onChange={(event) => updateDefault('accent', event.target.value)} /></label></div><label className="admin-toggle"><input type="checkbox" checked={form.enabled} onChange={(event) => update('enabled', event.target.checked)} /> 在对话中启用此特效</label><label className="effects-code-label">HTML 时间轴源码<textarea spellCheck={false} value={form.html} onChange={(event) => update('html', event.target.value)} /></label><p className="effects-hint">内置组件：QJMotion.textRise / cardPop / lineDraw / imageDrift / splitWipe / fadeOut。保留 QJ_RUNTIME、QJ_DATA 和 main 时间轴插槽。</p><button className="admin-save" type="submit" disabled={busy}><Save size={17} />保存特效</button></form>
        </section>
        <section className="admin-panel effects-preview-panel"><div className="admin-panel-heading"><h2>预览与渲染</h2><span>24 FPS · MP4</span></div><div className="admin-form-grid"><label>预览标题<input value={values.title} onChange={(event) => setValues({ ...values, title: event.target.value })} /></label><label>预览副标题<input value={values.subtitle} onChange={(event) => setValues({ ...values, subtitle: event.target.value })} /></label><label className="admin-wide">图片 HTTPS 地址（可选）<input type="url" value={values.imageUrl} onChange={(event) => setValues({ ...values, imageUrl: event.target.value })} placeholder="https://..." /></label></div><div className="effects-preview-actions"><button type="button" disabled={busy} onClick={() => void showPreview()}><Eye size={16} /> 预览动画</button><button type="button" disabled={busy || !form.id} onClick={() => void startRender()}><Film size={16} /> 渲染 MP4</button>{render?.status === 'succeeded' ? <button type="button" onClick={() => void download(render)}><Download size={16} /> 下载视频</button> : null}</div>{render ? <p className="effects-render-status" role="status">渲染状态：{render.status === 'succeeded' ? '已完成' : render.status === 'failed' ? `失败：${render.error}` : '处理中…'}</p> : null}<div className="effects-preview-shell" style={{ width: form.width * scale, height: form.height * scale }}>{preview ? <iframe title="特效动画预览" sandbox="allow-scripts" srcDoc={preview} style={{ width: form.width, height: form.height, transform: `scale(${scale})` }} /> : <div className="effects-preview-empty">点击「预览动画」查看当前 HTML</div>}</div>{renders.length ? <div className="effects-history"><h3>最近渲染</h3>{renders.slice(0, 8).map((item) => <div key={item.id}><span>{effects.find((effect) => effect.id === item.effectId)?.name || '已删除模板'} · {item.status === 'succeeded' ? '已完成' : item.status === 'failed' ? '失败' : '处理中'}</span>{item.downloadUrl ? <button type="button" onClick={() => void download(item)}><Download size={14} /> 下载</button> : null}</div>)}</div> : null}</section>
      </div> : <div className="admin-panel admin-empty">还没有特效模板。</div>}
    </div>
  </div>;
}
