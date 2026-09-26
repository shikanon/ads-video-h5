import express, { type ErrorRequestHandler, type Response } from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AppSettings, AppState, Artifact, ChatMessage, Job, JobKind, MediaItem, Session } from '../src/types';
import { answerWithPi, createImagePromptWithPi, createMusicQueryWithPi, createNarrationWithPi, createPlanWithPi, detectImage, detectShots, probeAudio, probeVideo, renderPlan, runFFmpeg } from './core';
import { writePresetBgm } from './bgm';
import { download24bitAudio, downloadPixabayAudio, getPixabayTrackDetail, MusicSourceError, musicSearchLinks, pixabayAudioUrl, search24bitMusic, searchPixabayMusic } from './music';
import { getDefaultTextModelId, getModelConfig, listPublicModels } from './modelRegistry';
import { generateAudio, generateImage, ProviderError } from './providers';
import { mountAdminRoutes } from './adminRoutes';
import { createAuth, userOf, type PublicUser } from './auth';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.QINGJIAN_DATA_DIR ? path.resolve(process.env.QINGJIAN_DATA_DIR) : path.join(root, 'data');
const mediaDir = path.join(dataDir, 'media');
const artifactDir = path.join(dataDir, 'artifacts');
const exportDir = path.join(dataDir, 'exports');
const tmpDir = path.join(dataDir, 'uploads');
const stateFile = path.join(dataDir, 'app-state.json');
const port = Number(process.env.PORT || 8787);
const publicBase = `/${(process.env.PUBLIC_BASE_PATH || '').replace(/^\/+|\/+$/g, '')}`.replace(/^\/$/, '');
const publicUrl = (url: string) => `${publicBase}${url}`;
await Promise.all([mediaDir, artifactDir, exportDir, tmpDir].map((dir) => mkdir(dir, { recursive: true })));

interface StoredState {
  activeSessionId: string;
  sessions: Session[];
  media: MediaItem[];
  artifacts: Artifact[];
  jobs: Job[];
  settings: Omit<AppSettings, 'defaultModelId'>;
  artifactFiles: Record<string, string>;
  narrationBySession: Record<string, string>;
  bgmBySession: Record<string, string>;
  profiles: Record<string, { activeSessionId: string; settings: AppSettings }>;
}
const now = () => new Date().toISOString();
function newSession(modelId: string | null): Session {
  const timestamp = now();
  return { id: randomUUID(), title: '新会话', modelId, createdAt: timestamp, updatedAt: timestamp, messages: [], plan: null };
}
const firstSession = newSession(await getDefaultTextModelId());
const emptyState = (): StoredState => ({ activeSessionId: firstSession.id, sessions: [firstSession], media: [], artifacts: [], jobs: [], settings: { language: 'zh-CN', chatBackground: null }, artifactFiles: {}, narrationBySession: {}, bgmBySession: {}, profiles: {} });
let state: StoredState = await readFile(stateFile, 'utf8').then((text) => ({ ...emptyState(), ...JSON.parse(text) as Partial<StoredState> })).catch(() => emptyState());
function normalizePlanSummary(plan: NonNullable<Session['plan']>): NonNullable<Session['plan']> {
  const core = plan.summary.split(/[；;]/).filter((part) => !/(封面|cover|thumbnail|poster)/i.test(part)).join('；').replace(/[。.!！\s；;]+$/, '') || '已整理剪辑方案';
  const coverName = state.media.find((item) => item.id === plan.coverMediaId && item.kind === 'image')?.name;
  return { ...plan, summary: `${core}${coverName ? `；封面：${coverName}` : ''}。`.slice(0, 160) };
}
if (!Array.isArray(state.sessions) || !state.sessions.length) state.sessions = [firstSession];
state.narrationBySession ||= {};
state.bgmBySession ||= {};
state.profiles ||= {};
for (const session of state.sessions) if (session.plan) session.plan = normalizePlanSummary(session.plan);
for (const artifact of state.artifacts) if (artifact.plan) artifact.plan = normalizePlanSummary(artifact.plan);
if (!state.sessions.some((session) => session.id === state.activeSessionId)) state.activeSessionId = state.sessions[0].id;
for (const job of state.jobs) if (job.status === 'running') job.status = 'queued';
let saveTail = Promise.resolve();
function saveState(): Promise<void> {
  const snapshot = JSON.stringify(state, null, 2);
  saveTail = saveTail.catch(() => undefined).then(async () => {
    const temp = `${stateFile}.${randomUUID()}.tmp`;
    await writeFile(temp, snapshot, { mode: 0o600 });
    await rename(temp, stateFile);
  });
  return saveTail;
}
await saveState();
const owned = (item: { ownerId?: string }, ownerId: string) => item.ownerId === ownerId;
const getSession = (id: string, ownerId?: string) => state.sessions.find((session) => session.id === id && (!ownerId || owned(session, ownerId)));
async function profileOf(user: PublicUser) {
  let profile = state.profiles[user.id];
  if (!profile) {
    const defaultModelId = await getDefaultTextModelId();
    profile = state.profiles[user.id];
    if (!profile) {
      const session = { ...newSession(defaultModelId), ownerId: user.id };
      state.sessions.unshift(session);
      profile = { activeSessionId: session.id, settings: { defaultModelId, language: 'zh-CN', chatBackground: null } };
      state.profiles[user.id] = profile;
      await saveState();
    }
  }
  return profile;
}
const shortName = (name: string) => path.basename(name).replace(/[\u0000-\u001f/\\]/g, '').slice(0, 120) || '素材';
const extFor = (mime: string) => mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : mime === 'image/png' ? 'png' : mime === 'audio/mpeg' ? 'mp3' : mime === 'audio/wav' || mime === 'audio/x-wav' ? 'wav' : mime === 'audio/ogg' ? 'ogg' : 'bin';

async function publicState(user: PublicUser): Promise<AppState> {
  const [models, textConfig, profile] = await Promise.all([listPublicModels(), getModelConfig('text'), profileOf(user)]);
  return { activeSessionId: profile.activeSessionId, sessions: state.sessions.filter((item) => owned(item, user.id)), media: state.media.filter((item) => owned(item, user.id)).map((item) => ({ ...item, url: publicUrl(item.url), shots: item.shots?.map((shot) => ({ ...shot, thumbnailUrl: publicUrl(shot.thumbnailUrl) })) })), artifacts: state.artifacts.filter((item) => owned(item, user.id)).map((item) => ({ ...item, url: publicUrl(item.url), downloadUrl: publicUrl(item.downloadUrl), ...(item.coverUrl ? { coverUrl: publicUrl(item.coverUrl) } : {}) })), jobs: state.jobs.filter((item) => owned(item, user.id)), settings: profile.settings, models, mode: textConfig ? 'pi' : 'unconfigured' };
}
function classify(message: string): JobKind {
  const lower = message.toLowerCase();
  if (/https:\/\/cdn\.pixabay\.com\/download\/audio\//i.test(message) || /(?:搜索|查找|找|搜|推荐).{0,35}(?:bgm|背景音乐|配乐|音乐)|(?:bgm|背景音乐|配乐|音乐).{0,24}(?:搜索|查找|推荐)/i.test(message)) return 'music';
  if (/(?:bgm|背景音乐|配乐)/i.test(message) && !/(?:成片|导出|生成视频|制作视频|export|render)/i.test(message)) return 'plan';
  if (/\b(?:generate|create|write|make|record|synthesize)\s+(?:a |an |the )?(?:(?:short|warm|chinese|new)\s+)*(?:narration|voiceover|voice-over|speech|audio)\b/.test(lower)) return 'audio';
  if (/\b(?:generate|create|draw|make)\s+(?:a |an |the )?(?:(?:warm|new|simple|vertical)\s+)*(?:image|cover|poster|illustration|picture|thumbnail)\b/.test(lower)) return 'image';
  if (/(生成|画|制作).{0,10}(封面|图片|海报)/.test(message) && !/(生成|制作).{0,10}(成片|视频)/.test(message)) return 'image';
  const changeCover = /(?:移除|去掉|取消|不要|把|将|用|设为|设置|作为|remove|clear|use|set|make).{0,24}(?:封面|cover|thumbnail|poster)/i.test(message);
  const exportVideo = /(?:生成|导出|重新生成|制作)(?:(?!图片|照片|插图|封面).){0,10}(?:成片|视频|mp4)|(?:export|render|generate|create)(?:(?!image|photo|picture|cover|poster).){0,16}(?:video|film|mp4)/i.test(message);
  if (changeCover && !exportVideo) return 'plan';
  if (/(?:剪|片段|拼接|调整|时长|画幅).{0,40}(?:图片|照片|插图)|(?:图片|照片|插图).{0,40}(?:剪|片段|拼接|调整|时长|画幅)|(?:image|photo|picture).{0,40}(?:clip|trim|edit|video)|(?:clip|trim|edit).{0,40}(?:image|photo|picture)/i.test(message) && !exportVideo) return 'plan';
  if (/(?:export|render|make|create|generate).{0,24}(?:video|mp4|film)|(?:video|mp4|film).{0,24}(?:export|render)/.test(lower)) return 'export';
  if (/(?:remove|mute|disable).{0,24}(?:narration|voiceover|voice-over|audio)/.test(lower)) return 'plan';
  if (/(?:add|include|mix).{0,24}(?:narration|voiceover|voice-over|audio).{0,24}(?:video|film)|(?:narration|voiceover|voice-over|audio).{0,24}(?:add|include|mix).{0,24}(?:video|film)/.test(lower)) return 'export';
  if (/(?:remove|clear|use|set|make).{0,24}(?:cover|thumbnail|poster)/.test(lower) && !/(?:generate|create|draw|make)\s+(?:a |an |the )?(?:cover|thumbnail|poster)/.test(lower)) return 'plan';
  if (/(?:narration|voiceover|voice-over|audio|speech|read aloud)/.test(lower)) return 'audio';
  if (/(?:image|cover|poster|illustration|picture|thumbnail)/.test(lower)) return 'image';
  if (/(把|将|用|带上|加入|合入|配上).{0,12}(口播|配音|旁白|音频).{0,12}(成片|视频)|(?:口播|配音|旁白|音频).{0,12}(加入|合入|配上).{0,12}(成片|视频)/.test(message)) return 'export';
  if (/成片|导出.{0,8}(视频|mp4)|重新导出/.test(message)) return 'export';
  if (/(把|将|用|带上|加入|合入|配上|不要|移除|去掉|关闭).{0,12}(口播|配音|旁白|音频)/.test(message)) return 'plan';
  if (/(移除|去掉|取消|不要|把|将|用|设为|设置|作为).{0,24}封面/.test(message) && !/(生成|画|制作).{0,8}封面/.test(message)) return 'plan';
  if (/(口播|配音|旁白|朗读|语音|音频)/.test(message)) return 'audio';
  if (/(图片|封面|插图|海报|配图|画一张|生成图)/.test(message)) return 'image';
  if (/(导出|生成|制作|合成|渲染|重新生成).{0,12}(视频|mp4)/.test(message)) return 'export';
  return 'plan';
}
function addReply(session: Session, job: Job, text: string, artifactId?: string) {
  const existing = session.messages.find((message) => message.role === 'assistant' && message.jobId === job.id);
  if (existing) {
    existing.text = text;
    if (artifactId) existing.artifactIds = [...new Set([...(existing.artifactIds || []), artifactId])];
    return;
  }
  session.messages.push({ id: randomUUID(), role: 'assistant', text, createdAt: now(), jobId: job.id, artifactIds: artifactId ? [artifactId] : [] });
}
async function addArtifact(session: Session, job: Job, kind: Artifact['kind'], name: string, bytes: Buffer, mimeType: string, text?: string, duration?: number): Promise<Artifact> {
  const id = randomUUID();
  const filename = `${id}.${extFor(mimeType)}`;
  const artifactPath = path.join(artifactDir, filename);
  const mediaId = randomUUID();
  const mediaPath = path.join(mediaDir, mediaId);
  try {
    await writeFile(artifactPath, bytes, { mode: 0o600 });
    await copyFile(artifactPath, mediaPath);
  } catch (error) {
    await Promise.all([rm(artifactPath, { force: true }), rm(mediaPath, { force: true })]);
    throw error;
  }
  const version = state.artifacts.filter((item) => item.sessionId === session.id && item.kind === kind).length + 1;
  const artifact: Artifact = { id, ownerId: session.ownerId, sessionId: session.id, messageId: job.messageId, kind, name, url: `/api/artifacts/${id}`, downloadUrl: `/api/download/${id}`, createdAt: now(), version, ...(text ? { text } : {}), ...(duration ? { duration } : {}) };
  state.artifacts.push(artifact); state.artifactFiles[id] = filename;
  artifact.mediaId = mediaId;
  state.media.push({ id: mediaId, ownerId: session.ownerId, name, mimeType, kind, ...(duration ? { duration } : {}), url: `/api/media/${mediaId}`, createdAt: now(), origin: 'generated' });
  return artifact;
}
async function performJob(job: Job): Promise<void> {
  const session = getSession(job.sessionId);
  const message = session?.messages.find((item) => item.id === job.messageId);
  if (!session || !message || session.ownerId !== job.ownerId) throw new Error('会话或消息已不存在，无法处理此任务。');
  const media = state.media.filter((item) => item.ownerId === job.ownerId);
  const prompt = message.text;
  const history = session.messages.filter((item) => item.createdAt <= message.createdAt);
  const attached = (message.attachmentIds || []).map((id) => media.find((item) => item.id === id)).filter((item): item is MediaItem => Boolean(item));
  if (job.kind === 'music') {
    if (/https:\/\/cdn\.pixabay\.com\//i.test(prompt)) {
      const url = pixabayAudioUrl(prompt);
      if (!url) throw new Error('请提供 Pixabay 官方 CDN 的 MP3 下载地址。');
      const downloaded = await downloadPixabayAudio(url);
      job.progress = 55; await saveState();
      const id = randomUUID();
      const file = path.join(mediaDir, id);
      try {
        await writeFile(file, downloaded.bytes, { mode: 0o600 });
        const duration = await probeAudio(file);
        state.media.push({ id, ownerId: job.ownerId, name: downloaded.name, mimeType: 'audio/mpeg', kind: 'audio', duration, url: `/api/media/${id}`, createdAt: now(), origin: 'imported', sourceUrl: url.toString() });
        state.bgmBySession[session.id] = id;
      } catch (error) { await rm(file, { force: true }); throw error; }
      addReply(session, job, `已下载并导入「${downloaded.name}」，试听请到素材库；这首音乐已作为当前对话的 BGM。发送“生成成片”即可混音导出。发布前请核对 Pixabay 许可与曲目限制。`);
      return;
    }
    const textConfig = await getModelConfig('text', session.modelId);
    if (!textConfig) throw new Error('文本模型尚未配置，请在管理后台设置 API Key 后重试。');
    const query = await createMusicQueryWithPi(prompt, textConfig, history);
    const result = musicSearchLinks(query);
    addReply(session, job, `已整理 BGM 搜索词「${result.query}」。在下方打开原站试听和下载；下载后添加音频素材，并说“把这段音频作为 BGM”。24bit 曲目的使用权需逐首确认。`);
    const reply = session.messages.find((item) => item.role === 'assistant' && item.jobId === job.id);
    if (reply) reply.musicSearch = result;
    return;
  }
  const coverIntent = /(?:用|把|将|设置|设为|作为|指定|采用|use|set|make).{0,24}(?:封面|cover|thumbnail|poster)|(?:封面|cover|thumbnail|poster).{0,24}(?:设为|作为|使用|用作|as|for)/i.test(prompt);
  const removeCover = /(?:不要|移除|去掉|取消|remove|without|clear).{0,12}(?:封面|cover|thumbnail|poster)/i.test(prompt);
  const withCover = (plan: Session['plan']): NonNullable<Session['plan']> => {
    if (!plan) throw new Error('剪辑方案不存在。');
    if (removeCover) return normalizePlanSummary({ ...plan, coverMediaId: undefined });
    if (!coverIntent) return normalizePlanSummary({ ...plan, coverMediaId: session.plan?.coverMediaId });
    const attachedImage = attached.find((item) => item.kind === 'image');
    const recentImage = [...state.artifacts].reverse().find((item) => item.sessionId === session.id && item.kind === 'image' && item.mediaId);
    const candidate = attachedImage || media.find((item) => item.id === recentImage?.mediaId) || [...media].reverse().find((item) => item.kind === 'image');
    if (!candidate) throw new Error('请先添加一张图片，再指定它作为封面。');
    return normalizePlanSummary({ ...plan, coverMediaId: candidate.id });
  };
  const removeNarration = /(不要|移除|去掉|关闭).{0,8}(口播|配音|旁白|音频)|(?:remove|mute|disable|without).{0,24}(?:narration|voiceover|voice-over|audio)/i.test(prompt);
  const bgmIntent = /(?:bgm|背景音乐|配乐|background music)/i.test(prompt);
  const selectNarration = !bgmIntent && /(把|将|用|带|带上|含|包含|加上|加入|合入|配上).{0,12}(口播|配音|旁白|音频)|(?:口播|配音|旁白|音频).{0,12}(加入|合入|配上)|(?:add|include|mix|with).{0,24}(?:narration|voiceover|voice-over|audio)/i.test(prompt);
  const removeBgm = /(?:不要|移除|去掉|关闭|取消|remove|without|mute).{0,12}(?:bgm|背景音乐|配乐|background music)/i.test(prompt);
  if (removeBgm) delete state.bgmBySession[session.id];
  else if (bgmIntent) state.bgmBySession[session.id] = /(?:内置|默认|preset).{0,10}(?:bgm|背景音乐|配乐)|(?:bgm|背景音乐|配乐).{0,10}(?:内置|默认|preset)/i.test(prompt)
    ? 'preset' : attached.find((item) => item.kind === 'audio')?.id || state.bgmBySession[session.id] || 'preset';
  if (removeNarration) delete state.narrationBySession[session.id];
  if (selectNarration && !removeNarration && (job.kind === 'plan' || job.kind === 'export')) {
    const attachedAudio = attached.find((item) => item.kind === 'audio');
    const latestAudio = attachedAudio
      ? state.artifacts.find((item) => item.kind === 'audio' && item.mediaId === attachedAudio.id)
      : [...state.artifacts].reverse().find((item) => item.sessionId === session.id && item.kind === 'audio');
    if (!latestAudio) throw new Error('当前对话还没有口播音频，请先通过对话生成口播。');
    state.narrationBySession[session.id] = latestAudio.id;
  }
  if (job.kind === 'plan' && (removeNarration || selectNarration || bgmIntent) && !/(?:剪|分镜|片段|拼接|调整|时长|画幅|比例|排序|制作视频)/.test(prompt)) {
    addReply(session, job, bgmIntent ? (removeBgm ? '已从后续成片中移除背景音乐。' : `已为后续成片选择${state.bgmBySession[session.id] === 'preset' ? '内置轻快配乐' : '所选音频'}，发送“生成成片”即可导出。`) : removeNarration ? '已从后续成片中移除口播音轨。' : '已将现有口播加入成片方案，发送“生成成片”即可导出。');
    return;
  }
  if (job.kind === 'plan' && (coverIntent || removeCover) && !/(剪|片段|时长|画幅|比例|排序|调整|修改|拼接|trim|clip|duration|aspect|ratio|reorder|edit)/i.test(prompt)) {
    if (!session.plan) {
      addReply(session, job, '请先通过对话生成剪辑方案，再指定封面图片。');
      return;
    }
    session.plan = { ...withCover(session.plan), version: (session.plan.version || 0) + 1 };
    addReply(session, job, removeCover ? '已从后续成片中移除封面。' : '已把所选图片设为当前方案的封面，发送“生成成片”即可导出。');
    return;
  }
  if (job.kind === 'export') {
    if (!session.plan) {
      const editable = media.filter((item) => item.kind === 'video' || item.kind === 'image');
      if (!editable.length) throw new Error('请先添加视频或图片素材，再说“生成成片”。');
      const textConfig = await getModelConfig('text', session.modelId);
      if (!textConfig) throw new Error('文本模型尚未配置，请在管理后台设置 API Key 后重试。');
      const plan = withCover(await createPlanWithPi(prompt, textConfig, editable, history, null, attached));
      session.plan = { ...plan, version: 1 };
      job.progress = 8; await saveState();
    } else if (coverIntent || removeCover) {
      session.plan = { ...withCover(session.plan), version: (session.plan.version || 0) + 1 };
    }
    job.progress = 10; await saveState();
    const narrationId = state.narrationBySession[session.id];
    const narrationFile = narrationId && state.artifactFiles[narrationId] ? path.join(artifactDir, state.artifactFiles[narrationId]) : undefined;
    const bgmId = state.bgmBySession[session.id];
    const bgmFile = bgmId === 'preset' ? path.join(dataDir, 'preset-bgm.wav') : bgmId && media.some((item) => item.id === bgmId && item.kind === 'audio') ? path.join(mediaDir, bgmId) : undefined;
    if (bgmId && !bgmFile) throw new Error('背景音乐素材已被移除，请重新选择。');
    if (bgmId === 'preset') await writePresetBgm(bgmFile!);
    const plan = session.plan;
    const result = await renderPlan(plan, media, mediaDir, exportDir, narrationFile, bgmFile);
    const id = result.id;
    const cover = plan.coverMediaId ? media.find((item) => item.id === plan.coverMediaId && item.kind === 'image') : undefined;
    if (plan.coverMediaId && !cover) throw new Error('封面图片素材已被移除，请重新指定。');
    if (cover) await copyFile(path.join(mediaDir, cover.id), path.join(exportDir, `${id}-cover.${extFor(cover.mimeType)}`));
    const version = state.artifacts.filter((item) => item.sessionId === session.id && item.kind === 'video').length + 1;
    const artifact: Artifact = { id, ownerId: job.ownerId, sessionId: session.id, messageId: message.id, kind: 'video', name: `轻剪成片-v${version}.mp4`, url: `/api/artifacts/${id}`, downloadUrl: `/api/download/${id}`, createdAt: now(), version, duration: plan.targetSeconds, format: plan.format, plan: structuredClone(plan), hasNarration: Boolean(narrationFile), hasBgm: Boolean(bgmFile), ...(cover ? { coverUrl: `/api/artifacts/${id}/cover`, coverMimeType: cover.mimeType } : {}) };
    state.artifacts.push(artifact); job.artifactId = id;
    addReply(session, job, `成片 v${version} 已生成，可以预览并下载。${narrationFile ? '已合入口播音频。' : ''}${bgmFile ? '已合入背景音乐。' : ''}`, id);
    return;
  }
  const textConfig = await getModelConfig('text', session.modelId);
  if (!textConfig) throw new Error('文本模型尚未配置，请在管理后台设置 API Key 后重试。');
  if (job.kind === 'image') {
    const imageConfig = await getModelConfig('image');
    if (!imageConfig) throw new Error('图片模型尚未配置，请在管理后台设置 API Key 后重试。');
    const imagePrompt = await createImagePromptWithPi(prompt, textConfig, history);
    job.progress = 35; await saveState();
    const referenceItem = attached.find((item) => item.kind === 'image');
    const reference = referenceItem ? { bytes: await readFile(path.join(mediaDir, referenceItem.id)), mimeType: referenceItem.mimeType } : undefined;
    const result = await generateImage(imagePrompt, imageConfig, reference);
    const artifact = await addArtifact(session, job, 'image', `轻剪图片-${new Date().toISOString().slice(0, 10)}.${extFor(result.mimeType)}`, result.bytes, result.mimeType);
    job.artifactId = artifact.id; addReply(session, job, '图片已生成。你可以预览、下载，或继续通过对话调整。', artifact.id);
    return;
  }
  if (job.kind === 'audio') {
    const narration = await createNarrationWithPi(prompt, textConfig, history);
    addReply(session, job, `口播文案：\n${narration}\n\n正在合成独立音频…`);
    job.progress = 35; await saveState();
    const audioConfig = await getModelConfig('audio');
    if (!audioConfig) throw new Error('音频模型尚未配置，请在管理后台设置 API Key 后重试。');
    const result = await generateAudio(narration, audioConfig);
    const artifact = await addArtifact(session, job, 'audio', `轻剪口播-${new Date().toISOString().slice(0, 10)}.${extFor(result.mimeType)}`, result.bytes, result.mimeType, narration, result.durationSec);
    job.artifactId = artifact.id; addReply(session, job, `口播文案：\n${narration}\n\n独立音频已合成，可试听和下载。`, artifact.id);
    return;
  }
  const editable = media.filter((item) => item.kind === 'video' || item.kind === 'image');
  const isEditRequest = /(剪|分镜|镜头|片段|分割|裁|时长|比例|画幅|排序|节奏|拼接|视频|调整|修改|做一个)|(?:trim|split|cut|clip|duration|aspect|ratio|reorder|pace|edit|video)/i.test(prompt);
  if (isEditRequest && editable.length) {
    const plan = withCover(await createPlanWithPi(prompt, textConfig, editable, history, session.plan, attached));
    session.plan = { ...plan, version: (session.plan?.version || 0) + 1 };
    addReply(session, job, `${plan.summary} 已整理 ${plan.clips.length} 个片段，合计约 ${plan.targetSeconds} 秒。${bgmIntent ? '已加入背景音乐。' : ''}继续告诉我怎么调整，或发送“生成成片”。`);
  } else addReply(session, job, await answerWithPi(prompt, textConfig, media, history));
}
let processing = false;
async function processQueue() {
  if (processing) return;
  processing = true;
  try {
    while (true) {
      const job = state.jobs.find((item) => item.status === 'queued');
      if (!job) break;
      job.status = 'running'; job.updatedAt = now(); job.progress = 5; job.error = undefined;
      await saveState();
      try { await performJob(job); job.status = 'succeeded'; job.progress = 100; }
      catch (error) {
        job.status = 'failed'; job.progress = undefined;
        const message = error instanceof Error ? error.message : '处理失败';
        job.error = error instanceof ProviderError
          ? `${error.message}（${error.code}${error.status ? ` / HTTP ${error.status}` : ''}）`
          : /API Key|模型尚未配置|会话或消息|素材|剪辑方案|Pi Agent|图片描述|口播文案|BGM|Pixabay|音频超过|音频文件/.test(message)
            ? message : '生成失败，请检查模型配置、素材格式或网络后重试。';
        const session = getSession(job.sessionId);
        if (session) {
          const existing = session.messages.find((item) => item.role === 'assistant' && item.jobId === job.id);
          addReply(session, job, existing?.text.includes('口播文案：') ? `${existing.text.replace(/正在合成独立音频…$/, '')}\n音频合成失败：${job.error}` : job.error);
        }
      }
      job.updatedAt = now();
      const session = getSession(job.sessionId); if (session) session.updatedAt = now();
      await saveState();
    }
  } finally { processing = false; }
}

const app = express();
app.set('trust proxy', 'loopback');
app.use(express.json({ limit: '1mb' }));
mountAdminRoutes(app);
const auth = createAuth(dataDir, publicBase);
await auth.load();
auth.mount(app);
const upload = multer({ storage: multer.diskStorage({ destination: tmpDir, filename: (_request, _file, done) => done(null, randomUUID()) }), limits: { fileSize: 300 * 1024 * 1024, files: 6 }, fileFilter: (_request, file, done) => done(null, file.mimetype.startsWith('video/') || file.mimetype.startsWith('image/') || file.mimetype.startsWith('audio/')) });
function musicErrorResponse(response: Response, error: unknown) {
  if (error instanceof MusicSourceError) {
    const clientError = error.code.startsWith('INVALID_');
    response.status(clientError ? 400 : 502).json({ error: error.message, code: error.code, source: error.source, ...(error.upstreamStatus ? { upstreamStatus: error.upstreamStatus } : {}) });
    return;
  }
  response.status(502).json({ error: error instanceof Error ? error.message : '音乐站点请求失败。', code: 'UPSTREAM_REQUEST_FAILED' });
}
app.post('/api/music/search', async (request, response) => {
  const source = request.body?.source;
  try {
    if (source === 'pixabay') {
      if (request.body?.page !== undefined && Number(request.body.page) !== 1) return response.status(400).json({ error: 'Pixabay 当前搜索页只支持第 1 页。', code: 'INVALID_PAGE' });
      return response.json(await searchPixabayMusic(request.body?.query));
    }
    if (source === '24bit') return response.json(await search24bitMusic(request.body?.query, request.body?.page));
    return response.status(400).json({ error: 'source 仅支持 pixabay 或 24bit。', code: 'INVALID_SOURCE' });
  } catch (error) { musicErrorResponse(response, error); }
});
app.post('/api/music/pixabay/detail', async (request, response) => {
  try { response.json(await getPixabayTrackDetail(request.body?.detailUrl)); }
  catch (error) { musicErrorResponse(response, error); }
});
app.post('/api/music/pixabay/download', async (request, response) => {
  try {
    const url = typeof request.body?.url === 'string' ? pixabayAudioUrl(request.body.url) : null;
    if (!url) return response.status(400).json({ error: '只支持 Pixabay 官方 CDN 音乐 MP3 地址。', code: 'INVALID_TRACK_URL' });
    const file = await downloadPixabayAudio(url);
    response.type('audio/mpeg').attachment(file.name).send(file.bytes);
  } catch (error) { musicErrorResponse(response, error); }
});
app.post('/api/music/24bit/download', async (request, response) => {
  try {
    const file = await download24bitAudio(request.body?.track, request.body?.audioUrl, request.body?.detailUrl);
    response.type(file.mimeType).attachment(file.name).send(file.bytes);
  } catch (error) { musicErrorResponse(response, error); }
});
app.get('/api/state', async (request, response) => response.json(await publicState(userOf(request))));
app.post('/api/sessions', async (request, response) => { const user = userOf(request); const profile = await profileOf(user); const session = { ...newSession(profile.settings.defaultModelId), ownerId: user.id }; state.sessions.unshift(session); profile.activeSessionId = session.id; await saveState(); response.json(await publicState(user)); });
app.post('/api/sessions/:id/activate', async (request, response) => { const user = userOf(request); if (!getSession(request.params.id, user.id)) return response.status(404).json({ error: '对话不存在。' }); (await profileOf(user)).activeSessionId = request.params.id; await saveState(); response.json(await publicState(user)); });
app.post('/api/chat', async (request, response) => {
  const user = userOf(request);
  const session = getSession(String(request.body?.sessionId || ''), user.id);
  if (!session) return response.status(404).json({ error: '对话不存在，请刷新后重试。' });
  const text = typeof request.body?.message === 'string' ? request.body.message.trim().slice(0, 2000) : '';
  if (!text) return response.status(400).json({ error: '请输入想让轻剪完成的内容。' });
  const attachments = Array.isArray(request.body?.attachmentIds) ? request.body.attachmentIds : [];
  if (attachments.length > 6 || attachments.some((id: unknown) => typeof id !== 'string' || !state.media.some((item) => item.id === id && owned(item, user.id)))) return response.status(400).json({ error: '附件不存在或一次添加过多。' });
  const createdAt = now();
  const message: ChatMessage = { id: randomUUID(), role: 'user', text, createdAt, attachmentIds: attachments };
  const job: Job = { id: randomUUID(), ownerId: user.id, sessionId: session.id, messageId: message.id, kind: classify(text), status: 'queued', createdAt, updatedAt: createdAt, progress: 0 };
  message.jobId = job.id; session.messages.push(message);
  if (session.title === '新对话' || session.title === '新会话') session.title = text.slice(0, 24);
  session.updatedAt = createdAt; state.jobs.push(job);
  await saveState(); response.json(await publicState(user)); void processQueue();
});
app.post('/api/media', upload.array('files', 6), async (request, response) => {
  const user = userOf(request);
  const files = (request.files || []) as Express.Multer.File[];
  if (!files.length) return response.status(400).json({ error: '请选择视频、图片或音频文件。' });
  const moved: string[] = [];
  try {
    const items: MediaItem[] = [];
    for (const file of files) {
      let mimeType = file.mimetype; let duration: number | undefined; let kind: MediaItem['kind'];
      if (file.mimetype.startsWith('image/')) { const detected = detectImage(await readFile(file.path)); if (!detected) throw new Error('图片格式仅支持 PNG、JPEG 或 WebP。'); mimeType = detected; }
      else if (file.mimetype.startsWith('video/')) duration = (await probeVideo(file.path)).duration;
      else if (file.mimetype.startsWith('audio/')) { if (!['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/ogg'].includes(mimeType)) throw new Error('音频仅支持 MP3、WAV 或 OGG。'); duration = await probeAudio(file.path); }
      else throw new Error('仅支持视频、图片和音频素材。');
      kind = file.mimetype.startsWith('video/') ? 'video' : file.mimetype.startsWith('audio/') ? 'audio' : 'image';
      const shots = kind === 'video' ? await detectShots(file.path, duration!, file.filename) : undefined;
      const target = path.join(mediaDir, file.filename); await rename(file.path, target); moved.push(target);
      items.push({ id: file.filename, ownerId: user.id, name: shortName(file.originalname), mimeType, kind, ...(duration ? { duration } : {}), ...(shots ? { shots } : {}), url: `/api/media/${file.filename}`, createdAt: now(), origin: 'upload' });
    }
    state.media.push(...items); await saveState(); response.json(await publicState(user));
  } catch (error) { await Promise.all([...files.map((file) => file.path), ...moved].map((file) => rm(file, { force: true }))); response.status(400).json({ error: error instanceof Error ? error.message : '素材解析失败。' }); }
});
app.delete('/api/media/:id', async (request, response) => {
  const user = userOf(request);
  const item = state.media.find((media) => media.id === request.params.id && owned(media, user.id));
  if (!item) return response.status(404).json({ error: '素材不存在。' });
  state.media = state.media.filter((media) => media.id !== item.id);
  for (const session of state.sessions) if (owned(session, user.id) && (session.plan?.clips.some((clip) => clip.sourceId === item.id) || session.plan?.coverMediaId === item.id)) session.plan = null;
  for (const artifact of state.artifacts) if (owned(artifact, user.id) && artifact.mediaId === item.id) artifact.mediaId = undefined;
  await saveState(); await rm(path.join(mediaDir, item.id), { force: true }); response.json(await publicState(user));
});
app.get('/api/media/:id', (request, response) => { const item = state.media.find((media) => media.id === request.params.id && owned(media, userOf(request).id)); if (!item) return response.status(404).json({ error: '素材不存在。' }); response.type(item.mimeType).sendFile(path.join(mediaDir, item.id)); });
app.get('/api/media/:id/shots/:index', async (request, response) => {
  const item = state.media.find((media) => media.id === request.params.id && media.kind === 'video' && owned(media, userOf(request).id));
  const index = Number(request.params.index);
  if (!item?.shots?.[index] || !Number.isInteger(index)) return response.status(404).json({ error: '镜头不存在。' });
  const shot = item.shots[index];
  const thumbnail = path.join(mediaDir, `${item.id}-shot-${index}.jpg`);
  try {
    await runFFmpeg(['-hide_banner', '-loglevel', 'error', '-y', '-ss', String((shot.start + shot.end) / 2), '-i', path.join(mediaDir, item.id), '-frames:v', '1', '-vf', 'scale=320:-2', thumbnail], 30_000);
    response.type('image/jpeg').sendFile(thumbnail);
  } catch { response.status(500).json({ error: '缩略图生成失败。' }); }
});
app.get('/api/jobs/:id', (request, response) => { const job = state.jobs.find((item) => item.id === request.params.id && owned(item, userOf(request).id)); if (!job) return response.status(404).json({ error: '任务不存在。' }); response.json(job); });
app.post('/api/jobs/:id/retry', async (request, response) => {
  const user = userOf(request);
  const job = state.jobs.find((item) => item.id === request.params.id && owned(item, user.id));
  if (!job) return response.status(404).json({ error: '任务不存在。' });
  if (job.status !== 'failed') return response.status(409).json({ error: '只有失败的任务可以重试。' });
  job.status = 'queued'; job.error = undefined; job.progress = 0; job.updatedAt = now();
  const session = getSession(job.sessionId);
  const reply = session?.messages.find((item) => item.role === 'assistant' && item.jobId === job.id);
  if (reply) {
    if (job.kind === 'audio' && reply.text.includes('口播文案：')) {
      reply.text = reply.text.replace(/\n(?:音频合成失败：|正在合成独立音频…)[\s\S]*$/, '\n正在重试音频合成…');
    } else {
      session!.messages = session!.messages.filter((item) => item.id !== reply.id);
    }
  }
  await saveState(); response.json(await publicState(user)); void processQueue();
});
function artifactFile(artifact: Artifact) { if (artifact.kind === 'video') return path.join(exportDir, `${artifact.id}.mp4`); const filename = state.artifactFiles[artifact.id]; return filename ? path.join(artifactDir, path.basename(filename)) : null; }
app.get('/api/artifacts/:id/cover', (request, response) => {
  const artifact = state.artifacts.find((item) => item.id === request.params.id && item.kind === 'video' && owned(item, userOf(request).id));
  if (!artifact?.coverMimeType) return response.status(404).json({ error: '封面不存在。' });
  response.type(artifact.coverMimeType).sendFile(path.join(exportDir, `${artifact.id}-cover.${extFor(artifact.coverMimeType)}`));
});
app.get('/api/artifacts/:id', (request, response) => { const artifact = state.artifacts.find((item) => item.id === request.params.id && owned(item, userOf(request).id)); const file = artifact && artifactFile(artifact); if (!artifact || !file) return response.status(404).json({ error: '产物不存在。' }); response.sendFile(file); });
app.get('/api/download/:id', (request, response) => { const artifact = state.artifacts.find((item) => item.id === request.params.id && owned(item, userOf(request).id)); const file = artifact && artifactFile(artifact); if (!artifact || !file) return response.status(404).json({ error: '产物不存在。' }); response.download(file, artifact.name); });
app.patch('/api/settings', async (request, response) => {
  const user = userOf(request);
  const profile = await profileOf(user);
  const body = request.body as Partial<AppSettings> | undefined;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return response.status(400).json({ error: '设置格式无效。' });
  if ('language' in body && body.language !== 'zh-CN' && body.language !== 'en-US') return response.status(400).json({ error: '不支持的语言。' });
  if ('chatBackground' in body && body.chatBackground !== null && (typeof body.chatBackground !== 'string' || body.chatBackground.length > 500_000)) return response.status(400).json({ error: '对话背景图片无效或过大。' });
  if ('defaultModelId' in body) { const id = body.defaultModelId; if (id !== null && (typeof id !== 'string' || !(await listPublicModels()).some((model) => model.id === id && model.kind === 'text' && model.enabled))) return response.status(400).json({ error: '默认文本模型不可用。' }); profile.settings.defaultModelId = id!; }
  if ('language' in body) profile.settings.language = body.language!;
  if ('chatBackground' in body) profile.settings.chatBackground = body.chatBackground!;
  await saveState(); response.json(await publicState(user));
});
app.use(((error, _request, response, _next) => { if (error instanceof multer.MulterError) { response.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? '单个文件不能超过 300 MB。' : '一次最多上传 6 个文件。' }); return; } response.status(500).json({ error: '处理请求时出错，请重试。' }); }) satisfies ErrorRequestHandler);
app.use(express.static(path.join(root, 'dist')));
app.get('/{*path}', (_request, response) => response.sendFile(path.join(root, 'dist', 'index.html')));
app.listen(port, '127.0.0.1', () => console.log(`轻剪 API listening on http://127.0.0.1:${port}`));
void processQueue();
