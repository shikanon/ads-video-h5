import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowRight, Check, Clock3, Film, ImagePlus, Play, Plus, Scissors, Send, Sparkles, X } from 'lucide-react';
import type { ChatMessage, EditClip, MediaItem, ProjectState } from './types';

const exampleMessage = '把这段旅行素材剪成 15 秒竖屏短片，节奏轻快';
const exampleScenes = [
  { title: '出发 · 拥抱风景', time: '4.8s', position: '35% 70%' },
  { title: '海岸 · 日落时分', time: '5.2s', position: '58% 26%' },
  { title: '漫步 · 收获美好', time: '4.6s', position: '80% 82%' },
];

function seconds(value: number) {
  const whole = Math.round(value);
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
}

async function readJson(response: Response): Promise<ProjectState> {
  const json = await response.json() as ProjectState & { error?: string };
  if (!response.ok) throw new Error(json.error || '请求失败，请重试。');
  return json;
}

function MediaThumb({ item, onRemove }: { item: MediaItem; onRemove: () => void }) {
  return (
    <div className="media-tile">
      <video src={item.url} muted playsInline preload="metadata" aria-label={item.name} />
      <span className="media-duration">{seconds(item.duration)}</span>
      <button type="button" className="media-remove" aria-label={`删除素材 ${item.name}`} onClick={onRemove}><X size={16} strokeWidth={2.4} /></button>
    </div>
  );
}

function ChatBubble({ message }: { message: ChatMessage }) {
  return (
    <div className={`chat-row ${message.role}`}>
      {message.role === 'assistant' ? <span className="chat-avatar ai"><Sparkles size={18} fill="currentColor" strokeWidth={1.6} /></span> : null}
      <div className="chat-bubble">{message.text}</div>
      {message.role === 'user' ? <span className="chat-avatar person"><span /></span> : null}
    </div>
  );
}

function SceneCard({ index, item, clip }: { index: number; item?: MediaItem; clip?: EditClip }) {
  const example = exampleScenes[index % exampleScenes.length];
  return (
    <div className="scene-card">
      <div className="scene-image">
        {item ? <video src={item.url} muted playsInline preload="metadata" aria-hidden="true" /> : <img src="/travel-cover.png" alt="" style={{ objectPosition: example.position }} />}
        <span className="scene-number">{index + 1}</span>
        <span className="scene-duration">{clip ? `${(clip.end - clip.start).toFixed(1)}s` : example.time}</span>
      </div>
      <span className="scene-title">{item ? item.name : example.title}</span>
    </div>
  );
}

export default function App() {
  const [project, setProject] = useState<ProjectState | null>(null);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState<'upload' | 'chat' | 'export' | null>(null);
  const [error, setError] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const chatEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/project').then(readJson).then(setProject).catch(() => setError('服务暂时不可用，请确认本地服务已启动。'));
  }, []);

  async function uploadFiles(files: FileList | null) {
    if (!files?.length) return;
    setError('');
    setBusy('upload');
    const form = new FormData();
    Array.from(files).forEach((file) => form.append('videos', file));
    try {
      setProject(await readJson(await fetch('/api/media', { method: 'POST', body: form })));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '上传失败。');
    } finally {
      setBusy(null);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function removeMedia(id: string) {
    setError('');
    try {
      setProject(await readJson(await fetch(`/api/media/${id}`, { method: 'DELETE' })));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '删除素材失败。');
    }
  }

  async function sendMessage() {
    const text = prompt.trim();
    if (!text || busy) return;
    if (!project?.media.length) {
      setError('先添加一段视频，再告诉我你想怎么剪。');
      fileInput.current?.click();
      return;
    }
    setError('');
    setBusy('chat');
    setPrompt('');
    try {
      const next = await readJson(await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      }));
      setProject(next);
      requestAnimationFrame(() => chatEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }));
    } catch (cause) {
      setPrompt(text);
      setError(cause instanceof Error ? cause.message : '剪辑方案生成失败。');
    } finally {
      setBusy(null);
    }
  }

  async function exportVideo() {
    if (!project?.plan || busy) return;
    setError('');
    setBusy('export');
    try {
      setProject(await readJson(await fetch('/api/export', { method: 'POST' })));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '生成成片失败。');
    } finally {
      setBusy(null);
    }
  }

  const media = project?.media || [];
  const messages = project?.messages || [];
  const plan = project?.plan;
  const firstSource = media[0];
  const scenes = plan?.clips || exampleScenes.map(() => undefined);

  return (
    <div className="page-backdrop">
      <main className="app-shell">
        <header className="topbar">
          <div className="brand" aria-label="轻剪">轻剪<span className="brand-dot">.</span></div>
          <button type="button" className="history-button" onClick={() => setShowHistory(true)}><Clock3 size={20} /> 历史</button>
        </header>

        <section className="intro" aria-labelledby="hero-title">
          <h1 id="hero-title">一句话，<span>剪出好视频</span></h1>
          <p>上传素材，告诉我你想要的节奏</p>
        </section>

        <section className="upload-section" aria-label="视频素材">
          <div className="upload-grid">
            {media.map((item) => <MediaThumb key={item.id} item={item} onRemove={() => void removeMedia(item.id)} />)}
            {!media.length ? <>
              <div className="sample-tile"><img src="/travel-cover.png" alt="示例旅行素材画面" /><span>示例</span></div>
              <div className="sample-tile second"><img src="/travel-cover.png" alt="示例海岸素材画面" /><span>示例</span></div>
            </> : null}
            <button type="button" className="add-tile" onClick={() => fileInput.current?.click()} disabled={busy === 'upload'}>
              {busy === 'upload' ? <span className="loading-ring" /> : <Plus size={28} strokeWidth={1.8} />}
              <span>{busy === 'upload' ? '上传中' : '添加素材'}</span>
            </button>
          </div>
          <input ref={fileInput} type="file" accept="video/*" multiple hidden onChange={(event) => void uploadFiles(event.target.files)} />
        </section>

        <section className="conversation" aria-label="剪辑对话">
          {messages.length ? messages.map((message, index) => <ChatBubble key={`${index}-${message.role}`} message={message} />) : (
            <>
              <div className="example-caption">对话示例</div>
              <ChatBubble message={{ role: 'user', text: exampleMessage }} />
              <ChatBubble message={{ role: 'assistant', text: '上传你的视频，我会先整理片段，再为你生成可下载的成片。' }} />
            </>
          )}
          {busy === 'chat' ? <div className="chat-row assistant"><span className="chat-avatar ai"><Sparkles size={18} fill="currentColor" /></span><div className="chat-bubble thinking"><i /><i /><i /> 正在整理剪辑方案</div></div> : null}
          <div ref={chatEnd} />
        </section>

        <section className="workspace" aria-labelledby="plan-title">
          <div className="section-heading">
            <div>
              <h2 id="plan-title">{plan ? '剪辑方案' : '成片预览'}</h2>
              <p>{plan ? plan.summary : '素材就绪后，对话生成你的专属剪辑方案'}</p>
            </div>
            <span className="aspect-label">{plan?.format || '9:16'} {plan?.format === '16:9' ? '横屏' : plan?.format === '1:1' ? '方形' : '竖屏'}</span>
          </div>

          <div className="scene-track">
            {scenes.map((clip, index) => (
              <SceneCard key={`${clip?.sourceId || 'demo'}-${index}`} index={index} item={clip ? media.find((entry) => entry.id === clip.sourceId) : undefined} clip={clip} />
            ))}
          </div>

          <div className="preview-stage">
            {project?.exportId ? (
              <video controls playsInline src={`/api/export/${project.exportId}`} aria-label="生成的成片预览" />
            ) : firstSource ? (
              <video controls playsInline src={firstSource.url} aria-label="原素材预览" />
            ) : (
              <img src="/travel-cover.png" alt="旅行视频画面示例" />
            )}
            {!project?.exportId ? <span className="preview-tag">{firstSource ? '原素材预览' : '示例画面'}</span> : <span className="preview-tag ready"><Check size={14} /> 成片已生成</span>}
            {!firstSource && !project?.exportId ? <span className="preview-play"><Play size={26} fill="currentColor" /></span> : null}
            <span className="preview-length">{plan ? seconds(plan.targetSeconds) : '00:15'}</span>
          </div>

          <div className="action-row">
            <button className="generate-button" type="button" onClick={() => void exportVideo()} disabled={!plan || Boolean(busy)}>
              {busy === 'export' ? <span className="loading-ring light" /> : <Scissors size={21} />}
              <span>{busy === 'export' ? '正在生成成片' : project?.exportId ? '重新生成' : '生成成片'}</span>
              {busy !== 'export' ? <ArrowRight size={19} /> : null}
            </button>
            {project?.exportId ? (
              <a className="download-button" href={`/api/download/${project.exportId}`} download="qingjian-export.mp4"><ArrowDownToLine size={20} />下载视频</a>
            ) : (
              <button className="download-button" type="button" disabled><ArrowDownToLine size={20} />下载视频</button>
            )}
          </div>
          <p className="mode-hint"><Film size={13} /> {project?.mode === 'pi' ? 'Pi Agent 已连接 · FFmpeg 本地生成' : '当前为演示剪辑规则 · 配置模型密钥后启用 Pi Agent'}</p>
        </section>

        {error ? <div role="alert" className="error-banner"><span>{error}</span><button type="button" onClick={() => setError('')} aria-label="关闭提示"><X size={16} /></button></div> : null}

        <form className="composer-wrap" onSubmit={(event) => { event.preventDefault(); void sendMessage(); }}>
          <div className="composer">
            <button type="button" className="attach-button" onClick={() => fileInput.current?.click()} aria-label="添加视频"><ImagePlus size={23} /></button>
            <input aria-label="剪辑要求" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="继续说说你想怎么剪…" maxLength={1000} />
            <button type="submit" className="send-button" aria-label="发送剪辑要求" disabled={!prompt.trim() || Boolean(busy)}><Send size={21} fill="currentColor" /></button>
          </div>
        </form>
      </main>

      {showHistory ? <div className="dialog-backdrop" onClick={() => setShowHistory(false)}><section className="history-dialog" role="dialog" aria-modal="true" aria-label="对话历史" onClick={(event) => event.stopPropagation()}><div className="dialog-header"><h2>对话历史</h2><button onClick={() => setShowHistory(false)} aria-label="关闭对话历史"><X size={20} /></button></div>{messages.length ? <div className="history-list">{messages.map((message, index) => <p key={index}><strong>{message.role === 'user' ? '你' : '轻剪'}</strong>{message.text}</p>)}</div> : <div className="history-empty"><Sparkles size={25} /><p>还没有剪辑对话</p><span>上传视频后，用一句话开始创作</span></div>}</section></div> : null}
    </div>
  );
}
