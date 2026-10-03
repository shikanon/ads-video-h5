import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, Pause, Play, RotateCcw } from 'lucide-react';
import { api } from './api';
import { effectPreview } from '../../../shared/effectPreview';
import type { EffectValues, HtmlEffect, Playback } from './effectTypes';

type Preview = { html: string; previewId: string };

export default function EffectPreview({ effect, token, values, draft = false, playback, large = false }: { effect: HtmlEffect; token: string; values?: EffectValues; draft?: boolean; playback: Playback; large?: boolean }) {
  const shell = useRef<HTMLDivElement>(null);
  const iframe = useRef<HTMLIFrameElement>(null);
  const [nearby, setNearby] = useState(false), [visible, setVisible] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null), [error, setError] = useState(''), [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(playback.playing), [time, setTime] = useState(0), [retry, setRetry] = useState(0);
  const [scale, setScale] = useState(0), [pageVisible, setPageVisible] = useState(!document.hidden);
  const body = JSON.stringify(draft ? { effect, values } : { values });
  const endpoint = draft ? '/api/admin/effects/preview-draft' : `/api/admin/effects/${effect.id}/preview`;
  const revision = effect.updatedAt;

  useEffect(() => {
    const element = shell.current;
    if (!element) return;
    const resize = new ResizeObserver(([entry]) => setScale(Math.min(entry.contentRect.width / effect.width, entry.contentRect.height / effect.height)));
    const inView = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: .12 });
    const prefetch = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) { setNearby(true); prefetch.disconnect(); } }, { rootMargin: '240px' });
    resize.observe(element); inView.observe(element); prefetch.observe(element);
    return () => { resize.disconnect(); inView.disconnect(); prefetch.disconnect(); };
  }, [effect.width, effect.height]);
  useEffect(() => {
    const listener = () => setPageVisible(!document.hidden);
    document.addEventListener('visibilitychange', listener);
    return () => document.removeEventListener('visibilitychange', listener);
  }, []);
  useEffect(() => { setPlaying(playback.playing); }, [playback]);
  useEffect(() => {
    if (!nearby) return;
    const controller = new AbortController();
    setReady(false); setError(''); setTime(0);
    const timer = window.setTimeout(() => {
      void api<{ html: string; previewId?: string }>(endpoint, token, { method: 'POST', body, signal: controller.signal }).then(result => {
        // Keep the established {html} API usable while older workers restart.
        if (!controller.signal.aborted) setPreview(result.previewId ? { html: result.html, previewId: result.previewId } : effectPreview(result.html, effect.duration));
      }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '动画加载失败。'); });
    }, draft ? 220 : 0);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [nearby, endpoint, body, revision, token, retry, draft, effect.duration]);
  useEffect(() => {
    if (!preview) return;
    const listener = (event: MessageEvent) => {
      if (event.source !== iframe.current?.contentWindow || event.data?.previewId !== preview.previewId) return;
      const message = event.data;
      if (message.type === 'qingjian:effect:error') { setError(String(message.error || '动画运行失败。')); return; }
      if (message.type === 'qingjian:effect:ready') {
        setReady(true);
        // A paused/reduced-motion gallery still needs an informative frame.
        if (!playing) iframe.current?.contentWindow?.postMessage({ type: 'qingjian:effect:control', previewId: preview.previewId, action: 'seek', time: Math.min(2.4, effect.duration * .4) }, '*');
      }
      if (message.type === 'qingjian:effect:ready' || message.type === 'qingjian:effect:state') setTime(Math.max(0, Math.min(effect.duration, Number(message.time) || 0)));
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, [preview, effect.duration, playing]);
  useEffect(() => {
    if (!preview || !ready) return;
    iframe.current?.contentWindow?.postMessage({ type: 'qingjian:effect:control', previewId: preview.previewId, action: playing && visible && pageVisible ? 'play' : 'pause' }, '*');
  }, [preview, ready, playing, visible, pageVisible]);
  useEffect(() => {
    if (!preview || ready || error) return;
    const timer = window.setTimeout(() => setError('动画未能启动，请重试。'), 8000);
    return () => window.clearTimeout(timer);
  }, [preview, ready, error]);

  function control(action: 'restart' | 'seek', value?: number) {
    if (!preview) return;
    if (action === 'seek') setPlaying(false);
    else setPlaying(true);
    iframe.current?.contentWindow?.postMessage({ type: 'qingjian:effect:control', previewId: preview.previewId, action, time: value }, '*');
  }
  return <div className={`effect-preview ${large ? 'is-large' : ''}`} data-effect-id={effect.id} data-preview-ready={ready} data-preview-time={time.toFixed(2)}>
    <div className="effect-preview-canvas" ref={shell} style={large ? { aspectRatio: `${effect.width} / ${effect.height}` } : undefined}>
      {preview && !error ? <iframe key={preview.previewId} ref={iframe} title={`${effect.name}动画预览`} sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={preview.html} style={{ width: effect.width, height: effect.height, transform: `translate(-50%, -50%) scale(${scale})` }} /> : null}
      {!ready || error ? <div className="effect-preview-placeholder" role="status">{error ? <><span>{error}</span><button type="button" onClick={() => { setPreview(null); setRetry(current => current + 1); }}>重新加载</button></> : <><LoaderCircle size={20} /><span>{nearby ? '加载动画…' : '滚动查看动画'}</span></>}</div> : null}
    </div>
    <div className="effect-player" aria-label={`${effect.name}播放控制`}>
      <button type="button" aria-label={`${playing ? '暂停' : '播放'}${effect.name}`} disabled={!ready || !!error} onClick={() => setPlaying(current => !current)}>{playing ? <Pause size={15} /> : <Play size={15} />}</button>
      <button type="button" aria-label={`重播${effect.name}`} disabled={!ready || !!error} onClick={() => control('restart')}><RotateCcw size={14} /></button>
      <input type="range" aria-label={`${effect.name}播放进度`} min={0} max={effect.duration} step={.01} value={time} disabled={!ready || !!error} onChange={event => control('seek', +event.target.value)} />
      <output>{time.toFixed(1)} / {effect.duration.toFixed(1)}s</output>
    </div>
  </div>;
}
