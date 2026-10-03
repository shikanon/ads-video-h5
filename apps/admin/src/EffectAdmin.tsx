import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Clapperboard, Copy, Download, Film, Pause, Play, Plus, Save, Search, Trash2, Upload, X } from 'lucide-react';
import { MAX_EFFECT_IMAGE_UPLOAD_BYTES, MAX_MEDIA_UPLOAD_BYTES } from '../../../shared/uploadLimits';
import { api, apiPath } from './api';
import EffectPreview from './EffectPreview';
import type { EffectAsset, EffectRender, EffectValues, HtmlEffect, Playback } from './effectTypes';
import './effects.css';

type Category = 'all' | 'text' | 'animation' | 'media';
const categoryNames: Record<Category, string> = { all: '全部特效', text: '文字特效', animation: '动画特效', media: '图片与视频' };
const categoryFor = (effect: HtmlEffect): Category => /照片|推镜|图片|photo|image/i.test(effect.name + effect.id) ? 'media' : /flow|chain|growth|reveal|流程|因果|趋势|成果/i.test(effect.id + effect.name) ? 'animation' : 'text';
const formatFor = (effect: HtmlEffect) => effect.width === effect.height ? '1:1' : effect.width > effect.height ? '16:9' : '9:16';
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export default function EffectAdmin({ token }: { token: string }) {
  const [effects, setEffects] = useState<HtmlEffect[]>([]), [form, setForm] = useState<HtmlEffect | null>(null);
  const [renders, setRenders] = useState<EffectRender[]>([]), [render, setRender] = useState<EffectRender | null>(null);
  const [assets, setAssets] = useState<EffectAsset[]>([]), [selectedAssetId, setSelectedAssetId] = useState('');
  const [category, setCategory] = useState<Category>('all'), [search, setSearch] = useState('');
  const [playback, setPlayback] = useState<Playback>(() => ({ playing: !reducedMotion(), revision: 0 }));
  const [loading, setLoading] = useState(true), [uploading, setUploading] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const detail = useRef<HTMLElement>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    const [catalog, history, media] = await Promise.all([
      api<{ effects: HtmlEffect[] }>('/api/admin/effects', token, { signal }),
      api<{ renders: EffectRender[] }>('/api/admin/effects/renders', token, { signal }),
      api<{ assets: EffectAsset[] }>('/api/admin/effects/assets', token, { signal }),
    ]);
    setEffects(catalog.effects); setRenders(history.renders); setAssets(media.assets);
  }, [token]);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '特效库加载失败。'); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [load]);
  useEffect(() => {
    if (!render || (render.status !== 'running' && render.status !== 'queued')) return;
    const controller = new AbortController();
    const timer = window.setInterval(() => {
      void api<{ render: EffectRender }>(`/api/admin/effects/renders/${render.id}`, token, { signal: controller.signal }).then(result => {
        if (!controller.signal.aborted) { setRender(result.render); setRenders(current => current.map(item => item.id === result.render.id ? result.render : item)); }
      }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '无法读取渲染状态。'); });
    }, 1400);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [render?.id, render?.status, token]);
  useEffect(() => {
    if (!form) return;
    detail.current?.scrollIntoView({ behavior: reducedMotion() ? 'instant' : 'smooth', block: 'start' });
  }, [form?.id]);

  function select(effect: HtmlEffect) { setForm(structuredClone(effect)); setSelectedAssetId(''); setRender(null); setError(''); setNotice(''); }
  function updateDefault(key: keyof EffectValues, value: string) { setForm(current => current ? { ...current, defaults: { ...current.defaults, [key]: value } } : null); }
  function duplicate(effect = form || effects[0]) {
    if (!effect) return;
    select({ ...effect, id: '', name: `${effect.name} · 副本`.slice(0, 80), createdAt: '', updatedAt: '' });
    setNotice('已复制为新特效，可调整文案与用途后保存。');
  }
  async function save(event: FormEvent) {
    event.preventDefault(); if (!form) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await api<{ effect: HtmlEffect }>(form.id ? `/api/admin/effects/${form.id}` : '/api/admin/effects', token, { method: form.id ? 'PUT' : 'POST', body: JSON.stringify(form) });
      setEffects(current => form.id ? current.map(item => item.id === form.id ? result.effect : item) : [...current, result.effect]);
      setForm(result.effect); setNotice('特效已保存，卡片预览已更新。');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败。'); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!form?.id || !window.confirm(`删除「${form.name}」？`)) return;
    setBusy(true); setError('');
    try { await api(`/api/admin/effects/${form.id}`, token, { method: 'DELETE' }); setEffects(current => current.filter(item => item.id !== form.id)); setForm(null); setNotice('特效已删除。'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '删除失败。'); }
    finally { setBusy(false); }
  }
  async function uploadAsset(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    const maxBytes = file.type.startsWith('image/') ? MAX_EFFECT_IMAGE_UPLOAD_BYTES : MAX_MEDIA_UPLOAD_BYTES;
    if (file.size > maxBytes) { setError(file.type.startsWith('image/') ? '图片不能超过 20 MB。' : '视频不能超过 100 MB，请先压缩。'); return; }
    setUploading(true); setError(''); setNotice('');
    try {
      const body = new FormData(); body.append('file', file);
      const result = await api<{ asset: EffectAsset }>('/api/admin/effects/assets', token, { method: 'POST', body });
      setAssets(current => [result.asset, ...current]); setSelectedAssetId(result.asset.id); setNotice(`${file.name} 已加入预览。`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '上传失败。'); }
    finally { setUploading(false); }
  }
  const previewValues = form ? { ...form.defaults, assetId: selectedAssetId, imageUrl: '', videoUrl: '' } : undefined;
  async function startRender() {
    if (!form?.id) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await api<{ render: EffectRender }>(`/api/admin/effects/${form.id}/render`, token, { method: 'POST', body: JSON.stringify({ values: previewValues }) });
      setRender(result.render); setRenders(current => [result.render, ...current]); setNotice('正在渲染，完成后可下载 MP4。');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '渲染失败。'); }
    finally { setBusy(false); }
  }
  async function download(item: EffectRender) {
    if (!item.downloadUrl) return;
    try {
      const response = await fetch(apiPath(item.downloadUrl), { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error('视频下载失败。');
      const blobUrl = URL.createObjectURL(await response.blob()), link = document.createElement('a');
      link.href = blobUrl; link.download = `${effects.find(effect => effect.id === item.effectId)?.name || '轻剪特效'}.mp4`; link.click();
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 30_000);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '下载失败。'); }
  }
  const filtered = effects.filter(item => (category === 'all' || categoryFor(item) === category) && `${item.name} ${item.description}`.toLowerCase().includes(search.trim().toLowerCase()));
  return <div className="effects-admin">
    <div className="admin-heading"><div><h1>HTML 视频特效库</h1><p>直接观看文字、图形和场景动画，选中后调整文案、素材并导出视频。</p></div><Clapperboard size={28} /></div>
    {error ? <div className="admin-alert" role="alert">{error}</div> : null}
    {notice ? <div className="admin-notice" role="status">{notice}</div> : null}
    <div className="effects-toolbar">
      <div className="effects-filters" aria-label="特效分类">{(Object.keys(categoryNames) as Category[]).map(item => <button key={item} type="button" className={category === item ? 'is-active' : ''} aria-pressed={category === item} onClick={() => setCategory(item)}>{categoryNames[item]}<span>{item === 'all' ? effects.length : effects.filter(effect => categoryFor(effect) === item).length}</span></button>)}</div>
      <div className="effects-toolbar-actions"><label className="effects-search"><Search size={16} /><input type="search" aria-label="搜索特效" placeholder="搜索名称或用途" value={search} onChange={event => setSearch(event.target.value)} /></label><button type="button" className="effects-secondary" onClick={() => setPlayback(current => ({ playing: !current.playing, revision: current.revision + 1 }))}>{playback.playing ? <Pause size={15} /> : <Play size={15} />}{playback.playing ? '暂停全部' : '播放全部'}</button></div>
    </div>
    {loading ? <div className="admin-panel admin-empty" role="status">正在加载特效库…</div> : filtered.length ? <div className="effects-gallery">{filtered.map(item => <article key={item.id} className={`effect-card ${form?.id === item.id ? 'is-selected' : ''}`}>
      <EffectPreview effect={item} token={token} playback={playback} />
      <div className="effect-card-body"><div className="effect-card-title"><h2>{item.name}</h2><span className={item.enabled ? 'admin-ready' : 'admin-muted'}>{item.enabled ? '已启用' : '已停用'}</span></div><p>{item.description}</p><div className="effect-card-meta"><span>{categoryNames[categoryFor(item)]}</span><span>{formatFor(item)} · {item.duration} 秒</span></div><button className="effects-select" type="button" onClick={() => select(item)} aria-label={`查看${item.name}并设置`}>查看与设置</button></div>
    </article>)}</div> : <div className="admin-panel admin-empty">{effects.length ? '没有匹配的特效。' : '还没有特效模板。'}{error ? <button type="button" className="effects-secondary" onClick={() => { setLoading(true); void load().catch(cause => setError(cause.message)).finally(() => setLoading(false)); }}>重新加载</button> : null}</div>}
    {effects.length ? <button type="button" className="effects-add effects-secondary" onClick={() => duplicate()}><Plus size={16} /> 从已有特效创建副本</button> : null}
    {form ? <section className="admin-panel effects-detail" ref={detail} aria-label="特效设置">
      <div className="admin-panel-heading"><div><h2>{form.id ? form.name : '创建特效副本'}</h2><p>{form.width} × {form.height} · {formatFor(form)} · {form.duration} 秒</p></div><div className="effects-inline-actions"><button type="button" disabled={busy} onClick={() => duplicate()}><Copy size={15} /> 复制</button>{form.id ? <button type="button" disabled={busy} onClick={() => void remove()}><Trash2 size={15} /> 删除</button> : null}<button type="button" aria-label="关闭特效设置" onClick={() => setForm(null)}><X size={18} /></button></div></div>
      <div className="effects-detail-grid"><div className="effects-detail-preview"><EffectPreview key={form.id || 'draft'} effect={form} token={token} values={previewValues} draft playback={playback} large /><div className="effects-preview-actions"><button type="button" disabled={busy || uploading || !form.id} onClick={() => void startRender()}><Film size={16} /> 渲染 MP4</button>{render?.status === 'succeeded' ? <button type="button" onClick={() => void download(render)}><Download size={16} /> 下载视频</button> : null}</div>{!form.id ? <p className="effects-hint">保存副本后即可渲染。</p> : null}{render ? <p className={`effects-render-status ${render.status === 'failed' ? 'is-error' : ''}`} role="status">{render.status === 'succeeded' ? '渲染已完成' : render.status === 'failed' ? `渲染失败：${render.error}` : '正在渲染…'}</p> : null}</div>
      <div><form onSubmit={event => void save(event)}><div className="admin-form-grid"><label className="admin-wide">特效名称<input value={form.name} maxLength={80} required onChange={event => setForm({ ...form, name: event.target.value })} /></label><label className="admin-wide">用途说明<input value={form.description} maxLength={240} onChange={event => setForm({ ...form, description: event.target.value })} /></label><label className="admin-wide">标题<input value={form.defaults.title} maxLength={60} onChange={event => updateDefault('title', event.target.value)} /></label><label className="admin-wide">副标题<input value={form.defaults.subtitle} maxLength={120} onChange={event => updateDefault('subtitle', event.target.value)} /></label><label>角标（选填）<input value={form.defaults.eyebrow} maxLength={120} onChange={event => updateDefault('eyebrow', event.target.value)} /></label><label>主题色<input type="color" value={form.defaults.accent} onChange={event => updateDefault('accent', event.target.value)} /></label></div><label className="admin-toggle"><input type="checkbox" checked={form.enabled} onChange={event => setForm({ ...form, enabled: event.target.checked })} /> 在视频生成中启用</label><button type="submit" className="admin-save" disabled={busy}><Save size={16} /> 保存设置</button></form>
      <div className="effects-asset-picker"><h3>预览素材</h3><label className="effects-upload"><Upload size={17} /><span>{uploading ? '正在上传…' : '选择图片或视频'}</span><input type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime" disabled={uploading || busy} onChange={event => void uploadAsset(event)} /></label><p>图片 20 MB 内，视频 100 MB 内。照片推镜、场景类特效可替换素材。</p>{selectedAssetId ? <div className="effects-selected-asset"><span>已选：{assets.find(asset => asset.id === selectedAssetId)?.name || '素材'}</span><button type="button" aria-label="移除已选素材" onClick={() => setSelectedAssetId('')}><X size={15} /></button></div> : null}{assets.length ? <div className="effects-asset-list" aria-label="已上传素材">{assets.slice(0, 12).map(asset => <button key={asset.id} type="button" className={selectedAssetId === asset.id ? 'is-selected' : ''} onClick={() => setSelectedAssetId(asset.id)}><span>{asset.kind === 'video' ? '视频' : '图片'}</span><strong title={asset.name}>{asset.name}</strong></button>)}</div> : null}</div></div></div>
    </section> : null}
    {renders.length ? <section className="admin-panel effects-history"><div className="admin-panel-heading"><h2>最近渲染</h2><span>{renders.length} 条</span></div>{renders.slice(0, 8).map(item => <div key={item.id}><span>{effects.find(effect => effect.id === item.effectId)?.name || '已删除特效'} · {item.status === 'succeeded' ? '已完成' : item.status === 'failed' ? '失败' : '处理中'}</span>{item.downloadUrl ? <button type="button" onClick={() => void download(item)}><Download size={14} /> 下载</button> : null}</div>)}</section> : null}
  </div>;
}
