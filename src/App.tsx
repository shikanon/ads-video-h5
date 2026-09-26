import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  Clock3,
  Film,
  Image as ImageIcon,
  ImagePlus,
  Library,
  Menu,
  Mic2,
  Music2,
  Plus,
  RotateCcw,
  Send,
  Settings2,
  Sparkles,
  Trash2,
  UserRound,
  WandSparkles,
  X,
} from "lucide-react";
import type {
  AppSettings,
  AppState,
  Artifact,
  ChatMessage,
  Job,
  MediaItem,
  Session,
} from "./types";

type Page =
  | "chat"
  | "history"
  | "media"
  | "films"
  | "settings"
  | "profile"
  | "terms"
  | "privacy"
  | "timeline";
type Locale = "zh-CN" | "en-US";
const apiPath = (url: string) => `${import.meta.env.BASE_URL.replace(/\/$/, "")}${url}`;
const landscapeUrl = `${import.meta.env.BASE_URL}travel-cover.png`;
const labels = {
  "zh-CN": {
    chat: "对话",
    history: "会话历史",
    media: "素材库",
    films: "成片库",
    settings: "设置",
    profile: "用户中心",
    terms: "用户协议",
    privacy: "隐私政策",
    timeline: "剪辑拼接",
    newChat: "新会话",
    hero: "一句话，剪出好视频",
    sub: "添加素材，告诉轻剪你想要的节奏",
    input: "继续说说你想怎么剪…",
    add: "添加素材",
    download: "下载",
    retry: "重试",
    back: "返回对话",
    emptyMedia: "还没有素材",
    emptyFilms: "还没有生成成片",
    emptyHistory: "还没有会话",
    plan: "剪辑方案",
    voice: "口播文案",
    audio: "独立音频",
    image: "生成图片",
    video: "成片视频",
    all: "全部",
    videos: "视频",
    images: "图片",
    audios: "音频",
    model: "默认对话模型",
    language: "界面语言",
    background: "对话背景",
    default: "默认背景",
    landscape: "暖色风景",
    custom: "本地图片",
    reset: "恢复默认",
    visitor: "访客",
    visitorHint: "当前为本机使用。账号登录与跨设备同步尚未开放。",
    unconfigured: "模型尚未配置，请管理员在后台设置。",
    legalDraft: "本地原型说明 · 正式上线前需由运营方确认完整条款",
    viewTimeline: "查看剪辑拼接",
    makeVideo: "对话生成成片",
  },
  "en-US": {
    chat: "Chat",
    history: "Conversations",
    media: "Media",
    films: "Exports",
    settings: "Settings",
    profile: "Profile",
    terms: "Terms",
    privacy: "Privacy",
    timeline: "Edit preview",
    newChat: "New conversation",
    hero: "Make a video with one sentence",
    sub: "Add media and tell Qingjian your idea",
    input: "Describe your next edit…",
    add: "Add media",
    download: "Download",
    retry: "Retry",
    back: "Back to chat",
    emptyMedia: "No media yet",
    emptyFilms: "No exported videos yet",
    emptyHistory: "No chats yet",
    plan: "Edit plan",
    voice: "Narration script",
    audio: "Audio track",
    image: "Generated image",
    video: "Exported video",
    all: "All",
    videos: "Videos",
    images: "Images",
    audios: "Audio",
    model: "Default chat model",
    language: "Language",
    background: "Chat background",
    default: "Default",
    landscape: "Warm landscape",
    custom: "Local image",
    reset: "Reset",
    visitor: "Guest",
    visitorHint:
      "Local use only. Accounts and cross-device sync are not available yet.",
    unconfigured: "No model is configured. Set one up in the admin console.",
    legalDraft: "Local prototype notice · final terms require operator review before launch",
    viewTimeline: "View timeline",
    makeVideo: "Export in chat",
  },
} as const;
const menuPages: Page[] = [
  "chat",
  "media",
  "films",
  "history",
  "profile",
  "settings",
];
const hints = {
  "zh-CN": [
    "把素材剪成 15 秒竖屏短片，节奏轻快",
    "写一段温柔的口播，并生成独立音频",
    "生成一张暖色调的封面图",
    "搜索轻快的 BGM",
  ],
  "en-US": [
    "Make a lively 15-second vertical video",
    "Write warm narration and generate audio",
    "Create a warm-toned cover image",
    "Search for upbeat background music",
  ],
};
function duration(value?: number) {
  const n = Math.max(0, Math.floor(value || 0));
  return `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
}
function date(value: string, locale: Locale) {
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString(locale, { month: "short", day: "numeric" });
}
async function getState(response: Response): Promise<AppState> {
  let json: (AppState & { error?: string }) | undefined;
  try {
    json = await response.json();
  } catch {
    /* handled below */
  }
  if (!response.ok)
    throw new Error(json?.error || `请求失败 (${response.status})`);
  if (!json?.sessions || !json?.media)
    throw new Error("服务返回的数据不完整。");
  return json;
}
async function api(url: string, method = "GET", body?: unknown) {
  return getState(
    await fetch(apiPath(url), {
      method,
      headers:
        body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}
function Visual({ item }: { item: MediaItem }) {
  if (item.kind === "image")
    return <img src={item.url} alt={item.name} loading="lazy" />;
  if (item.kind === "video")
    return (
      <video
        src={item.url}
        muted
        playsInline
        preload="metadata"
        aria-label={item.name}
      />
    );
  return (
    <span className="music-visual">
      <Music2 size={22} />
    </span>
  );
}
function ClipVisual({ item, start }: { item: MediaItem; start: number }) {
  const thumbnail = item.kind === "video" ? item.shots?.find((shot) => start >= shot.start - 0.05 && start < shot.end - 0.05)?.thumbnailUrl : undefined;
  return thumbnail ? <img src={thumbnail} alt={`${item.name} ${duration(start)}`} loading="lazy" /> : <Visual item={item} />;
}
function JobCard({
  job,
  locale,
  retry,
}: {
  job: Job;
  locale: Locale;
  retry: (id: string) => void;
}) {
  const t = labels[locale];
  const name =
    job.kind === "music"
      ? locale === "zh-CN" ? "BGM 搜索" : "Music search"
      : job.kind === "plan"
      ? t.plan
      : job.kind === "audio"
        ? t.audio
        : job.kind === "image"
          ? t.image
          : t.video;
  const status =
    job.status === "queued"
      ? locale === "zh-CN"
        ? "排队中"
        : "Queued"
      : job.status === "running"
        ? locale === "zh-CN"
          ? "生成中"
          : "Generating"
        : job.status === "failed"
          ? locale === "zh-CN"
            ? "生成失败"
            : "Failed"
          : locale === "zh-CN"
            ? "已完成"
            : "Done";
  return (
    <div className={`job-card ${job.status}`} aria-live="polite">
      <div className="job-head">
        <span className="job-icon">
          <Sparkles size={16} />
        </span>
        <strong>{name}</strong>
        <span className="job-status">{status}</span>
      </div>
      {job.status === "queued" || job.status === "running" ? (
        <div
          className="progress-track"
          role="progressbar"
          aria-label={status}
          aria-valuenow={job.progress || 0}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <span
            style={{
              width: `${Math.max(5, Math.min(100, job.progress || 5))}%`,
            }}
          />
        </div>
      ) : null}
      {job.status === "failed" ? (
        <div className="job-error">
          <span>{job.error || status}</span>
          <button type="button" onClick={() => retry(job.id)}>
            <RotateCcw size={14} />
            {t.retry}
          </button>
        </div>
      ) : null}
    </div>
  );
}
function ArtifactCard({
  artifact,
  locale,
  open,
  add,
}: {
  artifact: Artifact;
  locale: Locale;
  open: (artifact: Artifact) => void;
  add?: (artifact: Artifact) => void;
}) {
  const t = labels[locale];
  if (artifact.kind === "audio")
    return (
      <div className="artifact-card audio-card">
        {artifact.text ? (
          <div className="narration-block">
            <h3>{t.voice}</h3>
            <p>{artifact.text}</p>
          </div>
        ) : null}
        <div className="audio-title">
          <span>
            <Music2 size={19} />
          </span>
          <strong>
            {t.audio}
            <small>{artifact.name}</small>
          </strong>
        </div>
        <audio
          controls
          preload="metadata"
          src={artifact.url}
          aria-label={artifact.name}
        />
        <a
          className="artifact-download"
          href={artifact.downloadUrl}
          download={artifact.name}
        >
          <ArrowDownToLine size={16} />
          {t.download}
        </a>
      </div>
    );
  if (artifact.kind === "image")
    return (
      <div className="artifact-card image-card">
        <button
          type="button"
          className="artifact-visual"
          onClick={() => open(artifact)}
        >
          <img src={artifact.url} alt={artifact.name} loading="lazy" />
        </button>
        <div className="artifact-caption">
          <span>
            <ImageIcon size={16} />
            {artifact.name}
          </span>
          <a
            href={artifact.downloadUrl}
            download={artifact.name}
            aria-label={t.download}
          >
            <ArrowDownToLine size={18} />
          </a>
        </div>
        {artifact.mediaId && add ? (
          <button
            type="button"
            className="artifact-add"
            onClick={() => add(artifact)}
          >
            <Plus size={15} />
            {locale === "zh-CN" ? "加入当前对话" : "Add to chat"}
          </button>
        ) : null}
      </div>
    );
  return (
    <div className="artifact-card video-card">
      <button
        type="button"
        className="artifact-visual"
        onClick={() => open(artifact)}
      >
        <video
          src={artifact.url}
          poster={artifact.coverUrl}
          muted
          playsInline
          preload="metadata"
          aria-label={artifact.name}
        />
        <span className="play-mark">
          <Film size={22} />
        </span>
      </button>
      <div className="artifact-caption">
        <span>
          <Film size={16} />
          {artifact.name}
        </span>
        <a
          href={artifact.downloadUrl}
          download={artifact.name}
          aria-label={t.download}
        >
          <ArrowDownToLine size={18} />
        </a>
      </div>
    </div>
  );
}
function Message({
  message,
  state,
  locale,
  retry,
  open,
  add,
}: {
  message: ChatMessage;
  state: AppState;
  locale: Locale;
  retry: (id: string) => void;
  open: (artifact: Artifact) => void;
  add: (artifact: Artifact) => void;
}) {
  const jobs = state.jobs.filter((x) => x.messageId === message.id);
  const artifacts = state.artifacts.filter((x) => x.messageId === message.id);
  const attachments = (message.attachmentIds || [])
    .map((id) => state.media.find((x) => x.id === id))
    .filter((x): x is MediaItem => Boolean(x));
  return (
    <article className={`message-row ${message.role}`}>
      {message.role === "assistant" ? (
        <span className="avatar assistant-avatar">
          <Sparkles size={16} fill="currentColor" />
        </span>
      ) : null}
      <div className="message-main">
        {message.text ? (
          <div className="message-bubble">{message.text}</div>
        ) : null}
        {attachments.length ? (
          <div className="sent-attachments">
            {attachments.map((item) => (
              <div key={item.id}>
                <Visual item={item} />
                <span>{item.name}</span>
              </div>
            ))}
          </div>
        ) : null}
        {message.musicSearch ? (
          <div className="music-search-card">
            <div className="music-search-heading">
              <Music2 size={18} />
              <strong>{locale === "zh-CN" ? "站内搜索 BGM" : "Find background music"}</strong>
              <span>{message.musicSearch.query}</span>
            </div>
            <div className="music-source-list">
              {message.musicSearch.sources.map((source) => (
                <a key={source.name} href={source.url} target="_blank" rel="noopener noreferrer">
                  <span><b>{source.name}</b><small>{source.note}</small></span>
                  <ArrowRight size={17} />
                </a>
              ))}
            </div>
            <p>{locale === "zh-CN" ? "在原站下载并确认使用权后，回到轻剪上传音频；随后通过对话指定为 BGM。" : "Download from the source, check usage rights, then upload the audio and choose it in chat."}</p>
          </div>
        ) : null}
        {jobs.map((job) => (
          <JobCard key={job.id} job={job} locale={locale} retry={retry} />
        ))}
        {artifacts.map((artifact) => (
          <ArtifactCard
            key={artifact.id}
            artifact={artifact}
            locale={locale}
            open={open}
            add={add}
          />
        ))}
      </div>
      {message.role === "user" ? (
        <span className="avatar user-avatar">
          <UserRound size={16} />
        </span>
      ) : null}
    </article>
  );
}
export default function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [page, setPage] = useState<Page>("chat");
  const [drawer, setDrawer] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [attachments, setAttachments] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"all" | "video" | "image" | "audio">(
    "all",
  );
  const [imagePreview, setImagePreview] = useState<Artifact | null>(null);
  const [mediaPreview, setMediaPreview] = useState<MediaItem | null>(null);
  const [selectedVideo, setSelectedVideo] = useState<Artifact | null>(null);
  const [timelineCurrentPlan, setTimelineCurrentPlan] = useState(false);
  const [selectedClip, setSelectedClip] = useState(0);
  const [localBackground, setLocalBackground] = useState<string | null>(() =>
    localStorage.getItem("qingjian-local-bg"),
  );
  const drafts = useRef<Record<string, { prompt: string; attachments: string[] }>>({});
  const stateRef = useRef<AppState | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const bgInput = useRef<HTMLInputElement>(null);
  const chatEnd = useRef<HTMLDivElement>(null);
  const chatScroll = useRef<HTMLDivElement>(null);
  const chatScrollY = useRef(0);
  const visibleSessionId = useRef<string | null>(null);
  const chatAtBottom = useRef(true);
  const composerInput = useRef<HTMLTextAreaElement>(null);
  const previewVideo = useRef<HTMLVideoElement>(null);
  const apply = useCallback((next: AppState) => {
    stateRef.current = next;
    setState(next);
  }, []);
  const refresh = useCallback(async () => {
    try {
      apply(await api("/api/state"));
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法连接服务。");
    }
  }, [apply]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (
      !state?.jobs.some((j) => j.status === "queued" || j.status === "running")
    )
      return;
    const timer = window.setInterval(async () => {
      const job = stateRef.current?.jobs.find(
        (j) => j.status === "queued" || j.status === "running",
      );
      if (!job) return;
      try {
        const response = await fetch(apiPath(`/api/jobs/${job.id}`));
        if (response.ok) await refresh();
      } catch {
        /* next poll */
      }
    }, 2200);
    return () => window.clearInterval(timer);
  }, [state?.jobs, refresh]);
  useEffect(() => {
    if (!drawer) return;
    window.history.pushState({ qingjianDrawer: true }, "");
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawer(false);
    };
    const onBack = () => setDrawer(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("popstate", onBack);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("popstate", onBack);
      if (window.history.state?.qingjianDrawer) window.history.back();
    };
  }, [drawer]);
  const locale: Locale = state?.settings.language || "zh-CN";
  const t = labels[locale];
  const session = state?.sessions.find((s) => s.id === state.activeSessionId);
  const sessions = state?.sessions.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) || [];
  const sessionTitle = (item: Session) =>
    item.title === "新对话" || item.title === "新会话" ? t.newChat : item.title;
  const sessionPreview = (item: Session) =>
    item.messages.at(-1)?.text ||
    (locale === "zh-CN" ? "开始对话，创建这个主题" : "Start chatting in this topic");
  useLayoutEffect(() => {
    if (page !== "chat" || !chatScroll.current || !state?.activeSessionId) return;
    const view = chatScroll.current;
    view.scrollTop = visibleSessionId.current === state.activeSessionId
      ? chatScrollY.current
      : view.scrollHeight;
    visibleSessionId.current = state.activeSessionId;
  }, [page, state?.activeSessionId]);
  useEffect(() => {
    if (page === "chat" && chatAtBottom.current && chatScroll.current) {
      chatScroll.current.scrollTop = chatScroll.current.scrollHeight;
    }
  }, [page, session?.messages.length]);
  const artifacts =
    state?.artifacts.filter((a) => a.sessionId === session?.id) || [];
  const latestVideo =
    artifacts.filter((a) => a.kind === "video").at(-1) || null;
  const background =
    state?.settings.chatBackground === "local"
      ? localBackground
      : state?.settings.chatBackground;
  function nav(next: Page) {
    setDrawer(false);
    setPage(next);
    setError("");
  }
  async function mutate(url: string, method: string, body?: unknown) {
    setPending(true);
    setError("");
    try {
      apply(await api(url, method, body));
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "操作失败，请重试。");
      return false;
    } finally {
      setPending(false);
    }
  }
  function upload(files: FileList | null) {
    if (!files?.length) return;
    const selected = Array.from(files);
    if (
      selected.some(
        (f) => !f.type.startsWith("video/") && !f.type.startsWith("image/") && !f.type.startsWith("audio/"),
      )
    ) {
      setError(
        locale === "zh-CN"
          ? "只支持视频、图片和音频。"
          : "Only videos, images and audio are supported.",
      );
      return;
    }
    const oldIds = new Set(stateRef.current?.media.map((m) => m.id) || []);
    const form = new FormData();
    selected.forEach((f) => form.append("files", f));
    const xhr = new XMLHttpRequest();
    xhr.open("POST", apiPath("/api/media"));
    setError("");
    setUploadProgress(0);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable)
        setUploadProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      setUploadProgress(null);
      try {
        const result = JSON.parse(xhr.responseText) as AppState & {
          error?: string;
        };
        if (xhr.status < 200 || xhr.status >= 300)
          throw new Error(result.error || "上传失败。");
        apply(result);
        setAttachments((ids) => [
          ...new Set([
            ...ids,
            ...result.media
              .filter((m) => !oldIds.has(m.id) && (m.kind === "image" || m.kind === "audio"))
              .map((m) => m.id),
          ]),
        ]);
        nav("chat");
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "上传失败。");
      }
    };
    xhr.onerror = () => {
      setUploadProgress(null);
      setError("网络中断，上传失败。");
    };
    xhr.send(form);
    if (fileInput.current) fileInput.current.value = "";
  }
  async function send() {
    const message = prompt.trim();
    if (
      !message ||
      !state ||
      pending ||
      uploadProgress !== null
    )
      return;
    if (
      await mutate("/api/chat", "POST", {
        sessionId: state.activeSessionId,
        message,
        attachmentIds: attachments,
      })
    ) {
      delete drafts.current[state.activeSessionId];
      setPrompt("");
      setAttachments([]);
      requestAnimationFrame(() =>
        chatEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" }),
      );
    }
  }
  async function newChat() {
    const previousId = stateRef.current?.activeSessionId;
    if (previousId) drafts.current[previousId] = { prompt, attachments };
    if (await mutate("/api/sessions", "POST", {})) {
      setPrompt("");
      setAttachments([]);
      nav("chat");
    }
  }
  async function activate(id: string) {
    const previousId = stateRef.current?.activeSessionId;
    if (id === previousId) {
      nav("chat");
      return;
    }
    if (previousId) drafts.current[previousId] = { prompt, attachments };
    if (
      await mutate(
        `/api/sessions/${encodeURIComponent(id)}/activate`,
        "POST",
        {},
      )
    ) {
      const draft = drafts.current[id];
      setPrompt(draft?.prompt || "");
      setAttachments(draft?.attachments.filter((mediaId) => stateRef.current?.media.some((item) => item.id === mediaId)) || []);
      nav("chat");
    }
  }
  async function remove(id: string) {
    if (
      !window.confirm(
        locale === "zh-CN"
          ? "删除素材后，关联的剪辑方案可能无法继续导出。确定删除吗？"
          : "Deleting this media may prevent export. Delete it?",
      )
    )
      return;
    if (await mutate(`/api/media/${encodeURIComponent(id)}`, "DELETE"))
      setAttachments((ids) => ids.filter((x) => x !== id));
  }
  function shortcut(text: string) {
    setPrompt(text);
    nav("chat");
    requestAnimationFrame(() => composerInput.current?.focus());
  }
  function open(artifact: Artifact) {
    if (artifact.kind === "video") {
      setSelectedVideo(artifact);
      setTimelineCurrentPlan(false);
      setSelectedClip(0);
      nav("timeline");
    } else setImagePreview(artifact);
  }
  function addArtifact(artifact: Artifact) {
    if (!artifact.mediaId) return;
    setAttachments((ids) =>
      ids.includes(artifact.mediaId!) ? ids : [...ids, artifact.mediaId!],
    );
    nav("chat");
    requestAnimationFrame(() => composerInput.current?.focus());
  }
  async function patch(settings: Partial<AppSettings>) {
    await mutate("/api/settings", "PATCH", settings);
  }
  function backgroundFile(file?: File) {
    if (!file) return;
    if (!file.type.startsWith("image/") || file.size > 1024 * 1024) {
      setError("请选择不超过 1 MB 的图片。");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const value = String(reader.result || "");
      localStorage.setItem("qingjian-local-bg", value);
      setLocalBackground(value);
      void patch({ chatBackground: "local" });
    };
    reader.readAsDataURL(file);
    if (bgInput.current) bgInput.current.value = "";
  }
  const plan = session?.plan;
  const timelineArtifact = timelineCurrentPlan ? null : selectedVideo || latestVideo;
  const timelinePlan = timelineArtifact ? timelineArtifact.plan : plan;
  const clip = timelinePlan?.clips[selectedClip];
  const clipSource = state?.media.find((m) => m.id === clip?.sourceId);
  const timelineUrl = timelineArtifact?.url || clipSource?.url;
  return (
    <div className="page-backdrop">
      <main className="app-shell">
        <header className="topbar">
          {page === "chat" ? (
            <button
              type="button"
              className="brand"
              onClick={() => setDrawer(true)}
              aria-label="打开菜单"
            >
              轻剪<span>.</span>
              <Menu size={17} />
            </button>
          ) : (
            <button
              type="button"
              className="top-back"
              onClick={() =>
                nav(
                  page === "terms" || page === "privacy" ? "settings" : "chat",
                )
              }
              aria-label={t.back}
            >
              <ArrowLeft size={23} />
            </button>
          )}
          {page !== "chat" ? <h1 className="page-title">{t[page]}</h1> : null}
          {page === "chat" ? (
            <button
              type="button"
              className="top-history"
              onClick={() => nav("history")}
            >
              <Clock3 size={19} />
              {t.history}
            </button>
          ) : page === "history" ? (
            <button
              type="button"
              className="top-plus"
              onClick={() => void newChat()}
              aria-label={t.newChat}
            >
              <Plus size={22} />
            </button>
          ) : (
            <span className="top-spacer" />
          )}
        </header>
        {page === "chat" && session ? (
          <button type="button" className="session-bar" onClick={() => nav("history")}>
            <span>{locale === "zh-CN" ? "当前会话" : "Current topic"}</span>
            <strong>{sessionTitle(session)}</strong>
            <ChevronRight size={15} />
          </button>
        ) : null}
        {page !== "chat" && error ? (
          <div className="subpage-error" role="alert">
            <span>{error}</span>
            <button
              type="button"
              onClick={() => setError("")}
              aria-label="关闭"
            >
              <X size={15} />
            </button>
          </div>
        ) : null}
        {page === "chat" ? (
          <>
            <div
              className="chat-scroll"
              ref={chatScroll}
              onScroll={(event) => {
                const view = event.currentTarget;
                chatScrollY.current = view.scrollTop;
                chatAtBottom.current = view.scrollHeight - view.clientHeight - view.scrollTop < 80;
              }}
              style={
                background
                  ? {
                      backgroundImage: `linear-gradient(#fffdfadd,#fffdfadd),url(${background})`,
                    }
                  : undefined
              }
            >
              {!state ? (
                <div className="loading-state" role="status">
                  <Sparkles size={23} />
                  {locale === "zh-CN" ? "正在加载对话…" : "Loading chat…"}
                </div>
              ) : null}
              {state && !session?.messages.length ? (
                <section className="chat-empty">
                  <div className="empty-sparkle">
                    <Sparkles size={29} fill="currentColor" />
                  </div>
                  <h1>{t.hero}</h1>
                  <p>{t.sub}</p>
                  <div className="suggestions">
                    {hints[locale].map((hint, index) => (
                      <button
                        type="button"
                        key={hint}
                        onClick={() => shortcut(hint)}
                      >
                        {index === 0 ? (
                          <Film size={18} />
                        ) : index === 1 ? (
                          <Mic2 size={18} />
                        ) : (
                          <ImageIcon size={18} />
                        )}
                        <span>{hint}</span>
                        <ArrowRight size={16} />
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="add-media-inline"
                    onClick={() => fileInput.current?.click()}
                  >
                    <Plus size={18} />
                    {t.add}
                  </button>
                </section>
              ) : null}
              {session?.messages.length ? (
                <section className="message-list" aria-label={t.chat}>
                  {session.messages.map((message) => (
                    <Message
                      key={message.id}
                      message={message}
                      state={state!}
                      locale={locale}
                      retry={(id) =>
                        void mutate(`/api/jobs/${id}/retry`, "POST", {})
                      }
                      open={open}
                      add={addArtifact}
                    />
                  ))}
                </section>
              ) : null}
              {plan ? (
                <section className="plan-card">
                  <div className="section-head">
                    <div>
                      <h2>{t.plan}</h2>
                      <p>{plan.summary}</p>
                    </div>
                    <span className="format-chip">{plan.format}</span>
                  </div>
                  {plan.coverMediaId ? (
                    <div className="plan-cover">
                      <img src={state?.media.find((item) => item.id === plan.coverMediaId)?.url} alt="成片封面" />
                      <span>{locale === "zh-CN" ? "当前封面" : "Current cover"}</span>
                    </div>
                  ) : null}
                  <div className="clip-strip">
                    {plan.clips.map((part, index) => {
                      const source = state?.media.find(
                        (m) => m.id === part.sourceId,
                      );
                      return (
                        <button
                          type="button"
                          className="clip-card"
                          key={`${part.sourceId}-${index}`}
                          onClick={() => {
                            setSelectedClip(index);
                            setSelectedVideo(null);
                            setTimelineCurrentPlan(true);
                            nav("timeline");
                          }}
                        >
                          <span className="clip-visual">
                            {source ? (
                              <ClipVisual item={source} start={part.start} />
                            ) : (
                              <Film size={22} />
                            )}
                            <b>{index + 1}</b>
                          </span>
                          <span>{source?.name || `片段 ${index + 1}`}</span>
                          <small>{duration(part.end - part.start)}</small>
                        </button>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    className="plan-open"
                    onClick={() => {
                      setSelectedVideo(null);
                      setTimelineCurrentPlan(true);
                      nav("timeline");
                    }}
                  >
                    {t.viewTimeline}
                    <ChevronRight size={17} />
                  </button>
                </section>
              ) : null}
              <div ref={chatEnd} />
            </div>
            <form
              className="composer-wrap"
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
            >
              {state?.mode === "unconfigured" ? (
                <div className="model-warning">
                  <Settings2 size={14} />
                  {t.unconfigured}
                </div>
              ) : null}
              {uploadProgress !== null ? (
                <div className="upload-progress" role="status">
                  {locale === "zh-CN" ? "上传素材" : "Uploading"} ·{" "}
                  {uploadProgress}%
                  <span style={{ width: `${uploadProgress}%` }} />
                </div>
              ) : null}
              {error ? (
                <div className="error-banner" role="alert">
                  <span>{error}</span>
                  <button
                    type="button"
                    onClick={() => setError("")}
                    aria-label="关闭"
                  >
                    <X size={16} />
                  </button>
                </div>
              ) : null}
              <div className="composer">
                {attachments.length ? (
                  <div className="composer-attachments">
                    {attachments.map((id) => {
                      const item = state?.media.find((m) => m.id === id);
                      return item ? (
                        <div className="composer-attachment" key={id}>
                          <Visual item={item} />
                          <span>
                            {item.name}
                            <small>
                              {locale === "zh-CN" ? "本地素材" : "Local media"}
                            </small>
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              setAttachments((ids) =>
                                ids.filter((x) => x !== id),
                              )
                            }
                            aria-label={`移除 ${item.name}`}
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ) : null;
                    })}
                  </div>
                ) : null}
                <textarea
                  ref={composerInput}
                  aria-label={t.input}
                  placeholder={t.input}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={attachments.length ? 2 : 1}
                  maxLength={3000}
                  onKeyDown={(e) => {
                    if (
                      e.key === "Enter" &&
                      !e.shiftKey &&
                      !e.nativeEvent.isComposing
                    ) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                />
                <div className="composer-actions">
                  <button
                    type="button"
                    className="attach-button"
                    onClick={() => fileInput.current?.click()}
                    aria-label={t.add}
                  >
                    <ImagePlus size={21} />
                  </button>
                  <button
                    type="button"
                    className="library-button"
                    onClick={() => nav("media")}
                    aria-label={t.media}
                  >
                    <Library size={18} />
                  </button>
                  <button
                    type="submit"
                    className="send-button"
                    disabled={
                      pending ||
                      uploadProgress !== null ||
                      !prompt.trim()
                    }
                    aria-label="发送"
                  >
                    <Send size={20} fill="currentColor" />
                  </button>
                </div>
              </div>
            </form>
          </>
        ) : null}
        {page === "history" ? (
          <section className="subpage-content">
            <div className="history-intro">
              <strong>{locale === "zh-CN" ? "一个会话，一个创作主题" : "One conversation, one creative topic"}</strong>
              <p>{locale === "zh-CN"
                ? "切换主题后，继续沿用该会话的消息与剪辑方案；新会话从新的对话上下文开始。素材库在所有会话中可用。"
                : "Continue with this topic's messages and edit plan. A new conversation starts fresh; your media library remains available."}</p>
            </div>
            {sessions.length ? (
              <div className="history-list">
                {sessions.map((item) => (
                    <button
                      type="button"
                      className={`history-row ${item.id === state?.activeSessionId ? "active" : ""}`}
                      key={item.id}
                      onClick={() => void activate(item.id)}
                    >
                      <span className="history-icon">
                        <Sparkles size={18} />
                      </span>
                      <span>
                        <strong>{sessionTitle(item)}</strong>
                        <span className="history-preview">{sessionPreview(item)}</span>
                        <small>
                          {date(item.updatedAt, locale)} ·{" "}
                          {item.messages.length}{" "}
                          {locale === "zh-CN" ? "条消息" : "messages"}
                        </small>
                      </span>
                      {item.id === state?.activeSessionId
                        ? <em className="history-current">{locale === "zh-CN" ? "当前" : "Current"}</em>
                        : <ChevronRight size={17} />}
                    </button>
                  ))}
              </div>
            ) : (
              <div className="empty-state">
                <Clock3 size={28} />
                <h2>{t.emptyHistory}</h2>
                <button type="button" onClick={() => void newChat()}>
                  {t.newChat}
                </button>
              </div>
            )}
          </section>
        ) : null}
        {page === "media" ? (
          <section className="subpage-content">
            <div className="filter-tabs" role="tablist">
              {(["all", "video", "image", "audio"] as const).map((value) => (
                <button
                  type="button"
                  key={value}
                  role="tab"
                  aria-selected={filter === value}
                  className={filter === value ? "active" : ""}
                  onClick={() => setFilter(value)}
                >
                  {value === "all"
                    ? t.all
                    : value === "video"
                      ? t.videos
                      : value === "image"
                        ? t.images
                        : t.audios}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="add-row"
              onClick={() => fileInput.current?.click()}
            >
              <Plus size={19} />
              {t.add}
            </button>
            {state?.media.filter((m) => filter === "all" || m.kind === filter)
              .length ? (
              <div className="media-list">
                {state.media
                  .filter((m) => filter === "all" || m.kind === filter)
                  .map((item) => (
                    <article className="library-item" key={item.id}>
                      <button
                        type="button"
                        className="library-preview"
                        onClick={() => setMediaPreview(item)}
                        aria-label={`预览 ${item.name}`}
                      >
                        <Visual item={item} />
                      </button>
                      <div>
                        <strong>{item.name}</strong>
                        <small>
                          {item.kind} · {date(item.createdAt, locale)}
                        </small>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setAttachments((ids) =>
                            ids.includes(item.id) ? ids : [...ids, item.id],
                          );
                          nav("chat");
                        }}
                        aria-label={`选择 ${item.name}`}
                      >
                        <Plus size={19} />
                      </button>
                      <button
                        type="button"
                        className="delete-media"
                        onClick={() => void remove(item.id)}
                        aria-label={`删除 ${item.name}`}
                      >
                        <Trash2 size={17} />
                      </button>
                    </article>
                  ))}
              </div>
            ) : (
              <div className="empty-state">
                <Library size={28} />
                <h2>{t.emptyMedia}</h2>
              </div>
            )}
          </section>
        ) : null}
        {page === "films" ? (
          <section className="subpage-content">
            {state?.jobs
              .filter((j) => j.kind === "export" && j.status !== "succeeded")
              .map((job) => (
                <JobCard
                  key={job.id}
                  job={job}
                  locale={locale}
                  retry={(id) =>
                    void mutate(`/api/jobs/${id}/retry`, "POST", {})
                  }
                />
              ))}
            {state?.artifacts.some((a) => a.kind === "video") ? (
              <div className="film-list">
                {state.artifacts
                  .filter((a) => a.kind === "video")
                  .slice()
                  .reverse()
                  .map((item) => (
                    <div className="film-library-card" key={item.id}>
                      <ArtifactCard
                        artifact={item}
                        locale={locale}
                        open={open}
                      />
                      <div className="film-meta">
                        <span>
                          V{item.version} · {date(item.createdAt, locale)}
                        </span>
                        <button
                          type="button"
                          onClick={() => void activate(item.sessionId)}
                        >
                          {t.back}
                          <ArrowRight size={15} />
                        </button>
                      </div>
                    </div>
                  ))}
              </div>
            ) : !state?.jobs.some((j) => j.kind === "export") ? (
              <div className="empty-state">
                <Film size={28} />
                <h2>{t.emptyFilms}</h2>
                <p>
                  {locale === "zh-CN"
                    ? "在对话中要求生成成片，完成后可在这里下载。"
                    : "Ask for an export in chat, then download it here."}
                </p>
                <button type="button" onClick={() => nav("chat")}>
                  {t.back}
                </button>
              </div>
            ) : null}
          </section>
        ) : null}
        {page === "settings" ? (
          <section className="subpage-content settings-page">
            <div className="setting-group">
              <h2>{t.model}</h2>
              <select
                value={state?.settings.defaultModelId || ""}
                onChange={(e) =>
                  void patch({ defaultModelId: e.target.value || null })
                }
                aria-label={t.model}
              >
                <option value="">
                  {locale === "zh-CN" ? "自动选择" : "Auto select"}
                </option>
                {state?.models
                  .filter((m) => m.kind === "text" && m.enabled)
                  .map((m) => (
                    <option value={m.id} key={m.id}>
                      {m.name} · {m.provider}
                    </option>
                  ))}
              </select>
              <p>
                {locale === "zh-CN"
                  ? "用于之后创建的新对话。"
                  : "Used for new chats."}
              </p>
            </div>
            <div className="setting-group">
              <h2>{t.language}</h2>
              <div className="choice-row">
                <button
                  type="button"
                  className={locale === "zh-CN" ? "selected" : ""}
                  onClick={() => void patch({ language: "zh-CN" })}
                >
                  简体中文
                </button>
                <button
                  type="button"
                  className={locale === "en-US" ? "selected" : ""}
                  onClick={() => void patch({ language: "en-US" })}
                >
                  English
                </button>
              </div>
            </div>
            <div className="setting-group">
              <h2>{t.background}</h2>
              <div className="background-options">
                <button
                  type="button"
                  className={!background ? "selected" : ""}
                  onClick={() => void patch({ chatBackground: null })}
                >
                  <span className="bg-swatch default" />
                  {t.default}
                </button>
                <button
                  type="button"
                  className={
                    state?.settings.chatBackground === landscapeUrl || state?.settings.chatBackground === "/travel-cover.png"
                      ? "selected"
                      : ""
                  }
                  onClick={() =>
                    void patch({ chatBackground: landscapeUrl })
                  }
                >
                  <span className="bg-swatch landscape" />
                  {t.landscape}
                </button>
                <button
                  type="button"
                  className={
                    state?.settings.chatBackground === "local" ? "selected" : ""
                  }
                  onClick={() => bgInput.current?.click()}
                >
                  <span className="bg-swatch custom">+</span>
                  {t.custom}
                </button>
              </div>
              {background ? (
                <button
                  type="button"
                  className="reset-link"
                  onClick={() => void patch({ chatBackground: null })}
                >
                  {t.reset}
                </button>
              ) : null}
            </div>
            <div className="setting-group setting-links">
              <button type="button" onClick={() => nav("terms")}>
                {t.terms}
                <ChevronRight size={18} />
              </button>
              <button type="button" onClick={() => nav("privacy")}>
                {t.privacy}
                <ChevronRight size={18} />
              </button>
            </div>
          </section>
        ) : null}
        {page === "profile" ? (
          <section className="subpage-content">
            <div className="profile-card">
              <span>
                <UserRound size={30} />
              </span>
              <h2>{t.visitor}</h2>
              <p>{t.visitorHint}</p>
            </div>
          </section>
        ) : null}
        {page === "terms" || page === "privacy" ? (
          <section className="subpage-content legal-page">
            <h2>{page === "terms" ? t.terms : t.privacy}</h2>
            <p>{t.legalDraft}</p>
            {page === "terms" ? (
              locale === "zh-CN" ? (
                <>
                  <h3>使用与内容</h3>
                  <p>轻剪目前是单机原型。你应只上传自己有权使用的素材，并检查生成文案、图片、音频和成片是否适合发布。生成结果可能不准确，需要人工确认。</p>
                  <h3>任务与文件</h3>
                  <p>剪辑、生成和导出任务可能因为素材格式、网络或模型服务失败。你可以在页面重试；下载前请确认最终文件可以播放。删除素材可能使关联方案无法再次导出。</p>
                </>
              ) : (
                <>
                  <h3>Content and use</h3>
                  <p>Qingjian is currently a local prototype. Upload only media you have the right to use, and review generated text, images, audio, and videos before publishing. Results may be inaccurate.</p>
                  <h3>Jobs and files</h3>
                  <p>Jobs may fail because of media formats, network issues, or model services. You can retry them in the app. Check exported files before use. Removing media may prevent an edit plan from being exported again.</p>
                </>
              )
            ) : locale === "zh-CN" ? (
              <>
                <h3>本地存储</h3>
                <p>上传素材、对话、任务和生成结果保存在运行轻剪服务的设备上。对话背景的本地图片保存在当前浏览器中。清除浏览器数据不会自动删除服务端文件。</p>
                <h3>模型处理</h3>
                <p>为完成请求，服务端会将对话内容和必要的素材信息发送至已配置的文本模型；生成图片时会发送图片描述及你选择的参考图；生成口播时会发送口播文本。模型 API Key 由服务端保存，不会显示在普通页面中。</p>
                <h3>删除</h3>
                <p>你可以在素材库删除素材。当前原型没有账号和跨设备同步，也没有批量清除所有本机数据的页面。</p>
              </>
            ) : (
              <>
                <h3>Local storage</h3>
                <p>Uploads, chats, jobs, and generated results are stored on the device running Qingjian. A custom chat background is stored in this browser. Clearing browser data does not delete server files.</p>
                <h3>Model processing</h3>
                <p>The server sends chat content and necessary media information to the configured text model. Image generation sends a description and any reference image you select. Narration generation sends the script. API keys stay on the server and are not shown in the app.</p>
                <h3>Deletion</h3>
                <p>You can remove media from the library. This prototype has no accounts, cross-device sync, or bulk data deletion page.</p>
              </>
            )}
          </section>
        ) : null}
        {page === "timeline" ? (
          <section className="timeline-page">
            <div className="timeline-preview">
              {timelineUrl ? (
                <video
                  key={timelineUrl}
                  ref={previewVideo}
                  src={timelineUrl}
                  poster={timelineArtifact?.coverUrl}
                  controls
                  playsInline
                  preload="metadata"
                  onLoadedMetadata={() => {
                    if (!timelineArtifact && clip && previewVideo.current)
                      previewVideo.current.currentTime = clip.start;
                  }}
                />
              ) : (
                <div className="no-preview">
                  <Film size={31} />
                  <span>
                    {locale === "zh-CN" ? "暂无视频预览" : "No video preview"}
                  </span>
                </div>
              )}
            </div>
            {timelinePlan ? (
              <div className="timeline-panel">
                <div className="timeline-ruler">
                  <span>00:00</span>
                  <span>{duration(timelinePlan.targetSeconds / 2)}</span>
                  <span>{duration(timelinePlan.targetSeconds)}</span>
                </div>
                <div className="timeline-clips">
                  {timelinePlan.clips.map((part, index) => {
                    const source = state?.media.find(
                      (m) => m.id === part.sourceId,
                    );
                    return (
                      <button
                        type="button"
                        className={selectedClip === index ? "selected" : ""}
                        key={`${part.sourceId}-${index}`}
                        onClick={() => {
                          setSelectedClip(index);
                          if (timelineArtifact && previewVideo.current)
                            previewVideo.current.currentTime = timelinePlan.clips
                              .slice(0, index)
                              .reduce((sum, p) => sum + p.end - p.start, 0);
                        }}
                      >
                        <span className="timeline-visual">
                          {source ? <ClipVisual item={source} start={part.start} /> : null}
                        </span>
                        <span>
                          {locale === "zh-CN" ? "片段" : "Clip"} {index + 1}
                        </span>
                        <small>{duration(part.end - part.start)}</small>
                      </button>
                    );
                  })}
                </div>
                {timelineArtifact?.hasNarration ? (
                  <div className="audio-track">
                    <Music2 size={18} />
                    {locale === "zh-CN" ? "口播音轨" : "Narration track"}
                    <span />
                  </div>
                ) : null}
                {timelineArtifact?.hasBgm ? (
                  <div className="audio-track">
                    <Music2 size={18} />
                    {locale === "zh-CN" ? "背景音乐" : "Background music"}
                    <span />
                  </div>
                ) : null}
              </div>
            ) : timelineArtifact ? (
              <p className="timeline-snapshot-note">
                {locale === "zh-CN"
                  ? "此历史成片未保存片段快照，仍可播放和下载。"
                  : "This older export has no saved clip snapshot. You can still play and download it."}
              </p>
            ) : null}
            <div className="quick-tools">
              {[
                ["裁剪", "把当前片段裁剪到 "],
                ["分割", "在当前片段的 "],
                ["排序", "调整片段顺序为 "],
                ["配音", "为这支短片生成口播并配音"],
              ].map(([name, value], index) => (
                <button
                  type="button"
                  key={name}
                  onClick={() =>
                    shortcut(
                      locale === "zh-CN"
                        ? value
                        : [
                            "Trim this clip to ",
                            "Split this clip at ",
                            "Reorder clips as ",
                            "Add narration and voiceover",
                          ][index],
                    )
                  }
                >
                  {index === 3 ? (
                    <Mic2 size={22} />
                  ) : index === 2 ? (
                    <Library size={22} />
                  ) : (
                    <WandSparkles size={22} />
                  )}
                  <span>
                    {locale === "zh-CN"
                      ? name
                      : ["Trim", "Split", "Reorder", "Voiceover"][index]}
                  </span>
                </button>
              ))}
            </div>
            <button
              type="button"
              className="timeline-chat-button"
              onClick={() =>
                shortcut(
                  locale === "zh-CN"
                    ? "请根据当前方案生成成片"
                    : "Export the current plan as a video",
                )
              }
            >
              {t.makeVideo}
              <ArrowRight size={18} />
            </button>
            {timelineArtifact ? (
              <a
                className="timeline-download"
                href={timelineArtifact.downloadUrl}
                download={timelineArtifact.name}
              >
                <ArrowDownToLine size={17} />
                {t.download}
              </a>
            ) : null}
          </section>
        ) : null}
        <input
          ref={fileInput}
          type="file"
          accept="video/*,image/*,audio/mpeg,audio/wav,audio/x-wav,audio/ogg"
          multiple
          hidden
          onChange={(e) => upload(e.target.files)}
        />
        <input
          ref={bgInput}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => backgroundFile(e.target.files?.[0])}
        />
      </main>
      {drawer ? (
        <div className="drawer-overlay" onClick={() => setDrawer(false)}>
          <nav
            className="drawer"
            aria-label="主菜单"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="drawer-heading">
              <strong>
                轻剪<span>.</span>
              </strong>
              <button
                type="button"
                onClick={() => setDrawer(false)}
                aria-label="关闭"
              >
                <X size={20} />
              </button>
            </div>
            <button
              type="button"
              className="drawer-new"
              onClick={() => void newChat()}
            >
              <Plus size={19} />
              {t.newChat}
            </button>
            <section className="drawer-sessions" aria-label={t.history}>
              <div className="drawer-section-heading">
                <strong>{locale === "zh-CN" ? "最近会话" : "Recent conversations"}</strong>
                <button type="button" onClick={() => nav("history")}>{locale === "zh-CN" ? "查看全部" : "View all"}</button>
              </div>
              {sessions.slice(0, 5).map((item) => (
                <button
                  type="button"
                  className={`drawer-session ${item.id === state?.activeSessionId ? "active" : ""}`}
                  key={item.id}
                  onClick={() => void activate(item.id)}
                  aria-current={item.id === state?.activeSessionId ? "page" : undefined}
                >
                  <span>{sessionTitle(item)}</span>
                  <small>{sessionPreview(item)}</small>
                </button>
              ))}
            </section>
            <div className="drawer-links">
              {menuPages.map((item, index) => (
                <button
                  type="button"
                  key={item}
                  className={page === item ? "active" : ""}
                  onClick={() => nav(item)}
                >
                  {
                    [
                      <Sparkles size={19} />,
                      <Library size={19} />,
                      <Film size={19} />,
                      <Clock3 size={19} />,
                      <UserRound size={19} />,
                      <Settings2 size={19} />,
                    ][index]
                  }
                  <span>{t[item]}</span>
                  {page === item ? <i /> : null}
                </button>
              ))}
            </div>
            <a className="admin-link" href={`${import.meta.env.BASE_URL}admin`}>
              {locale === "zh-CN" ? "管理后台" : "Admin console"}
              <ChevronRight size={16} />
            </a>
            <div className="drawer-footer">
              <UserRound size={17} />
              {t.visitor}
            </div>
          </nav>
        </div>
      ) : null}
      {mediaPreview ? (
        <div className="preview-overlay" onClick={() => setMediaPreview(null)}>
          <div
            className="media-preview-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={mediaPreview.name}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="close-preview"
              onClick={() => setMediaPreview(null)}
              aria-label="关闭"
            >
              <X size={22} />
            </button>
            {mediaPreview.kind === "video" ? (
              <video src={mediaPreview.url} controls playsInline />
            ) : mediaPreview.kind === "audio" ? (
              <audio src={mediaPreview.url} controls />
            ) : (
              <img src={mediaPreview.url} alt={mediaPreview.name} />
            )}
            <strong>{mediaPreview.name}</strong>
            {mediaPreview.shots?.length ? (
              <div className="shot-list" aria-label="自动识别的分镜">
                <p>自动识别 {mediaPreview.shots.length} 个镜头 · 点击缩略图查看分镜</p>
                <div>
                  {mediaPreview.shots.map((shot, index) => (
                    <button key={index} type="button" onClick={() => { setMediaPreview(null); shortcut(`请将「${mediaPreview.name}」的第 ${index + 1} 个镜头（${shot.start}–${shot.end} 秒）整理成剪辑方案，并配上轻快背景音乐`); }}>
                      <img src={shot.thumbnailUrl} alt={`镜头 ${index + 1}`} loading="lazy" />
                      <span>镜头 {index + 1}<small>{duration(shot.start)}–{duration(shot.end)}</small></span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      {imagePreview ? (
        <div className="preview-overlay" onClick={() => setImagePreview(null)}>
          <div
            className="image-preview-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={imagePreview.name}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setImagePreview(null)}
              aria-label="关闭"
            >
              <X size={22} />
            </button>
            <img src={imagePreview.url} alt={imagePreview.name} />
            <a href={imagePreview.downloadUrl} download={imagePreview.name}>
              <ArrowDownToLine size={17} />
              {t.download}
            </a>
          </div>
        </div>
      ) : null}
    </div>
  );
}
