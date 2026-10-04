import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { LoaderCircle, Mic, X } from 'lucide-react';
import './voiceInput.css';

type Phase = 'idle' | 'permission' | 'recording' | 'recognizing' | 'sending';
interface Props {
  disabled: boolean;
  locale: string;
  endpoint: string;
  onBusyChange: (busy: boolean) => void;
  onRecognized: (text: string) => Promise<void>;
}
const MAX_SECONDS = 60;
const FORMATS = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm'];

export default function VoiceInput(props: Props) {
  const [phase, setPhase] = useState<Phase>('idle'), [seconds, setSeconds] = useState(0), [cancelArmed, setCancelArmed] = useState(false), [notice, setNotice] = useState('');
  const current = useRef(props); current.current = props;
  const alive = useRef(true), generation = useRef(0), held = useRef(false), startY = useRef(0), cancelOnRelease = useRef(false);
  const input = useRef<number | string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null), stream = useRef<MediaStream | null>(null), controller = useRef<AbortController | null>(null);
  const started = useRef(0), timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined), phaseRef = useRef<Phase>('idle');
  const zh = props.locale === 'zh-CN';
  function change(next: Phase) { phaseRef.current = next; if (alive.current) { setPhase(next); current.current.onBusyChange(next !== 'idle'); } }
  function cleanup() { clearInterval(timer.current); timer.current = undefined; stream.current?.getTracks().forEach(track => track.stop()); stream.current = null; }
  function cancel(message = '') {
    generation.current++; held.current = false; input.current = null; controller.current?.abort(); controller.current = null;
    const active = recorder.current; recorder.current = null;
    if (active && active.state !== 'inactive') active.stop();
    cleanup(); change('idle');
    if (alive.current) { setCancelArmed(false); setNotice(message); }
  }
  async function recognize(blob: Blob, token: number) {
    if (!alive.current || token !== generation.current) return;
    change('recognizing');
    const abort = new AbortController(); controller.current = abort;
    const timeout = setTimeout(() => abort.abort(), 95_000);
    try {
      const form = new FormData(); form.append('audio', blob, blob.type.includes('mp4') ? 'voice.mp4' : blob.type.includes('ogg') ? 'voice.ogg' : 'voice.webm');
      const response = await fetch(current.current.endpoint, { method: 'POST', body: form, signal: abort.signal });
      const result = await response.json() as { text?: unknown; error?: string };
      if (!response.ok) throw new Error(result.error || (zh ? '语音识别失败，请重录。' : 'Transcription failed. Please try again.'));
      if (typeof result.text !== 'string' || !result.text.trim()) throw new Error(zh ? '没有识别到清晰语音，请重新说一次。' : 'No clear speech detected. Please try again.');
      if (!alive.current || token !== generation.current) return;
      setNotice((zh ? '识别为：' : 'Recognized: ') + result.text.trim()); change('sending');
      await current.current.onRecognized(result.text.trim());
      if (alive.current && token === generation.current) setNotice('');
    } catch (error) {
      if (alive.current && token === generation.current) setNotice(error instanceof Error && error.name !== 'AbortError' ? error.message : zh ? '语音识别超时，请重录。' : 'Transcription timed out. Please try again.');
    } finally {
      clearTimeout(timeout);
      if (token === generation.current) { controller.current = null; change('idle'); }
    }
  }
  function finish(discard = false) {
    held.current = false; input.current = null;
    const active = recorder.current;
    if (!active) { if (phaseRef.current === 'permission') cancel(zh ? '请允许麦克风后，再次长按说话。' : 'Allow microphone access, then hold to speak again.'); return; }
    if (discard || Date.now() - started.current < 350) { cancel(zh ? discard ? '已取消录音' : '请长按按钮说出完整指令' : discard ? 'Recording cancelled' : 'Hold the button and speak your instruction'); return; }
    if (active.state === 'recording') { clearInterval(timer.current); change('recognizing'); active.stop(); }
  }
  async function begin() {
    if (props.disabled || phaseRef.current !== 'idle') return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { setNotice(zh ? '此浏览器无法录音，请在 HTTPS 页面或支持录音的浏览器中打开。' : 'Microphone recording needs HTTPS and a supported browser.'); return; }
    held.current = true; cancelOnRelease.current = false; setCancelArmed(false); setNotice(''); setSeconds(0); change('permission');
    const token = ++generation.current;
    const accessTimeout = setTimeout(() => { if (token === generation.current && phaseRef.current === 'permission') cancel(zh ? '麦克风响应超时，请检查浏览器权限后重试。' : 'Microphone timed out. Check browser permissions and try again.'); }, 15000);
    try {
      const input = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
      if (!alive.current || token !== generation.current || !held.current) { input.getTracks().forEach(track => track.stop()); return; }
      stream.current = input;
      const mimeType = FORMATS.find(type => MediaRecorder.isTypeSupported(type));
      const active = new MediaRecorder(input, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 96000 });
      recorder.current = active; const chunks: Blob[] = [];
      active.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      active.onerror = () => { if (token === generation.current) cancel(zh ? '录音中断，请重新说一次。' : 'Recording failed. Please try again.'); };
      active.onstop = () => {
        if (token !== generation.current || !alive.current) return;
        if (held.current) { cancel(zh ? '录音中断，请重新说一次。' : 'Recording interrupted. Please try again.'); return; }
        recorder.current = null; cleanup();
        const blob = new Blob(chunks, { type: active.mimeType || 'audio/webm' });
        if (!blob.size) { cancel(zh ? '没有录到声音，请重录。' : 'No audio recorded. Please try again.'); return; }
        void recognize(blob, token);
      };
      active.start(); started.current = Date.now(); change('recording');
      timer.current = setInterval(() => { const elapsed = Math.floor((Date.now() - started.current) / 1000); setSeconds(elapsed); if (elapsed >= MAX_SECONDS) finish(cancelOnRelease.current); }, 250);
    } catch (error) {
      if (!alive.current || token !== generation.current) return;
      cleanup(); held.current = false; change('idle');
      const denied = error instanceof DOMException && ['NotAllowedError', 'SecurityError'].includes(error.name);
      setNotice(zh ? denied ? '麦克风权限被拒绝，请在浏览器设置中允许后重试。' : '无法使用麦克风，请检查设备后重试。' : denied ? 'Microphone permission denied. Allow access in browser settings.' : 'Microphone unavailable. Check your device and try again.');
    } finally { clearTimeout(accessTimeout); }
  }
  useEffect(() => {
    alive.current = true;
    const hide = () => { if (document.visibilityState === 'hidden' && phaseRef.current !== 'idle') cancel(); };
    const escape = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape' && phaseRef.current !== 'idle') cancel(); };
    document.addEventListener('visibilitychange', hide); document.addEventListener('keydown', escape);
    return () => { alive.current = false; cancel(); current.current.onBusyChange(false); document.removeEventListener('visibilitychange', hide); document.removeEventListener('keydown', escape); };
  }, []);
  function down(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || props.disabled || phaseRef.current !== 'idle') return;
    event.preventDefault(); input.current = event.pointerId; event.currentTarget.setPointerCapture(event.pointerId); startY.current = event.clientY; void begin();
  }
  function move(event: PointerEvent<HTMLButtonElement>) {
    if (!held.current || input.current !== event.pointerId) return;
    cancelOnRelease.current = startY.current - event.clientY > 64; setCancelArmed(cancelOnRelease.current);
  }
  function keyDown(event: KeyboardEvent<HTMLButtonElement>) { if ([' ', 'Enter'].includes(event.key)) { event.preventDefault(); if (!event.repeat && phaseRef.current === 'idle') { input.current = event.key; void begin(); } } }
  function keyUp(event: KeyboardEvent<HTMLButtonElement>) { if ([' ', 'Enter'].includes(event.key)) { event.preventDefault(); if (input.current === event.key) finish(); } }
  function up(event: PointerEvent<HTMLButtonElement>) { if (input.current === event.pointerId) finish(cancelOnRelease.current); }
  function pointerCancelled(event: PointerEvent<HTMLButtonElement>) { if (input.current === event.pointerId && held.current) cancel(); }
  const recording = phase === 'recording', busy = phase !== 'idle', processing = phase === 'recognizing' || phase === 'sending';
  const status = phase === 'permission' ? zh ? '正在打开麦克风…' : 'Opening microphone…' : recording ? zh ? cancelArmed ? '松开取消' : '松开发送 · 上滑取消' : cancelArmed ? 'Release to cancel' : 'Release to send · Slide up to cancel' : phase === 'recognizing' ? zh ? '正在识别语音…' : 'Transcribing…' : phase === 'sending' ? zh ? '正在发送指令…' : 'Sending instruction…' : notice;
  return <div className={`voice-input${recording ? ' recording' : ''}${cancelArmed ? ' cancelling' : ''}`}>
    {(busy || notice) ? <div className="voice-status" role="status" aria-live="polite">
      {recording ? <span className="voice-wave" aria-hidden="true"><i/><i/><i/><i/><i/></span> : processing ? <LoaderCircle size={16} className="voice-spinner" aria-hidden="true"/> : <Mic size={16} aria-hidden="true"/>}
      <span>{status}{recording ? ` · ${seconds}s / ${MAX_SECONDS}s` : ''}</span>
      {(busy && !held.current && phase !== 'sending') || (!busy && notice) ? <button type="button" className="voice-dismiss" aria-label={zh ? busy ? '取消语音识别' : '关闭语音提示' : busy ? 'Cancel transcription' : 'Dismiss voice message'} onClick={() => cancel()}><X size={14}/></button> : null}
    </div> : null}
    <button type="button" className="voice-button" aria-label={zh ? '长按语音输入' : 'Hold to speak'} title={zh ? '长按说话，松开识别并发送；上滑取消' : 'Hold to speak, release to transcribe and send'} aria-pressed={recording} disabled={props.disabled && !busy || processing} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={pointerCancelled} onLostPointerCapture={pointerCancelled} onBlur={() => { if (held.current) cancel(); }} onKeyDown={keyDown} onKeyUp={keyUp} onContextMenu={event => event.preventDefault()} onClick={() => { if (phaseRef.current === 'idle' && !notice) setNotice(zh ? '长按说话，松开后自动识别并发送' : 'Hold to speak, release to transcribe and send'); }}>
      {processing ? <LoaderCircle size={20} className="voice-spinner" aria-hidden="true"/> : <Mic size={20} aria-hidden="true"/>}
    </button>
  </div>;
}
