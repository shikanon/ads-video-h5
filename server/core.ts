import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import ffmpegPath from 'ffmpeg-static';
import { Agent, type AgentTool } from '@earendil-works/pi-agent-core';
import { createModels, createProvider, type Model } from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { Type } from 'typebox';
import type { ChatMessage, EditPlan, Format, MediaItem, Shot } from '../src/types';
import type { ModelConfig } from './modelRegistry';

const ffmpeg = ffmpegPath || 'ffmpeg';

export function runFFmpeg(args: string[], timeoutMs = 180_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    let finished = false;
    const finish = (error?: Error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(stderr);
    };
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(new Error('视频处理超时，请缩短素材或重试。')); }, timeoutMs);
    child.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-12000); });
    child.on('error', (error) => finish(error));
    child.on('close', (code) => finish(code === 0 ? undefined : new Error(stderr || `FFmpeg exited ${code ?? 'unknown'}`)));
  });
}

export async function probeVideo(file: string): Promise<{ duration: number; hasAudio: boolean }> {
  let result = '';
  try { result = await runFFmpeg(['-hide_banner', '-i', file], 20_000); }
  catch (error) { result = error instanceof Error ? error.message : String(error); }
  const match = result.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!match || !/Video:/.test(result)) throw new Error('无法读取视频画面或时长，请换一个视频文件。');
  const duration = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  if (!Number.isFinite(duration) || duration < 0.5) throw new Error('视频时长太短，无法剪辑。');
  return { duration, hasAudio: /Audio:/.test(result) };
}

export async function probeAudio(file: string): Promise<number> {
  let result = '';
  try { result = await runFFmpeg(['-hide_banner', '-i', file], 20_000); }
  catch (error) { result = error instanceof Error ? error.message : String(error); }
  const match = result.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!match || !/Audio:/.test(result)) throw new Error('无法读取音频，请上传有效的 MP3、WAV 或 OGG 文件。');
  const duration = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  if (!Number.isFinite(duration) || duration < 1 || duration > 600) throw new Error('背景音乐时长需在 1 秒至 10 分钟之间。');
  return duration;
}

export async function detectShots(file: string, duration: number, mediaId: string): Promise<Shot[]> {
  const log = await runFFmpeg(['-hide_banner', '-nostats', '-i', file, '-vf', "select='gt(scene,0.25)',showinfo", '-an', '-f', 'null', '-'], 120_000);
  const cuts = [...log.matchAll(/pts_time:([\d.]+)/g)]
    .map((match) => Number(match[1]))
    .filter((time) => Number.isFinite(time) && time > 0.5 && time < duration - 0.5);
  const unique = cuts.filter((time, index) => index === 0 || time - cuts[index - 1] >= 0.5);
  const selected = unique.length <= 7 ? unique : Array.from({ length: 7 }, (_, index) => unique[Math.round(index * (unique.length - 1) / 6)]);
  const points = [0, ...selected, duration];
  return points.slice(0, -1).map((start, index) => ({
    start: +start.toFixed(2), end: +points[index + 1].toFixed(2), thumbnailUrl: `/api/media/${mediaId}/shots/${index}`,
  }));
}

export function detectImage(bytes: Buffer): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length > 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

export function validatePlan(input: EditPlan, media: MediaItem[], allowImageClips = true, attachedImageIds?: Set<string>): EditPlan {
  const formats: Format[] = ['9:16', '16:9', '1:1'];
  if (!formats.includes(input.format)) throw new Error('不支持的成片比例。');
  if (!Array.isArray(input.clips) || input.clips.length < 1 || input.clips.length > 8) throw new Error('请选择 1 到 8 个片段。');
  const clips = input.clips.map((clip) => {
    const source = media.find((item) => item.id === clip.sourceId && item.kind !== 'audio');
    if (!source) throw new Error('剪辑方案引用了不存在的图片或视频素材。');
    if (source.kind === 'image' && !allowImageClips) throw new Error('图片附件仅作为封面或视觉参考；如需放进视频画面，请在指令中明确说明。');
    if (source.kind === 'image' && attachedImageIds?.size && !attachedImageIds.has(source.id)) throw new Error('请使用当前消息附加的图片作为视频片段。');
    const max = source.kind === 'image' ? 60 : source.duration || 0;
    const start = Number(clip.start);
    const end = Number(clip.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || (source.kind === 'image' && start !== 0) || end - start < 0.5 || end > max + 0.05) {
      throw new Error(`片段时间超出素材「${source.name}」的范围。`);
    }
    return { sourceId: source.id, start: +start.toFixed(2), end: +Math.min(end, max).toFixed(2) };
  });
  const total = clips.reduce((sum, clip) => sum + clip.end - clip.start, 0);
  if (total > 60.05) throw new Error('成片最长为 60 秒。');
  const cover = input.coverMediaId ? media.find((item) => item.id === input.coverMediaId && item.kind === 'image') : undefined;
  if (input.coverMediaId && !cover) throw new Error('封面图片素材不存在。');
  return { format: input.format, targetSeconds: +total.toFixed(1), summary: String(input.summary || '已整理剪辑方案').slice(0, 160), clips, ...(cover ? { coverMediaId: cover.id } : {}) };
}

function textModel(config: ModelConfig) {
  const models = createModels();
  const provider = `qingjian-${config.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  const model: Model<'openai-completions'> = {
    id: config.modelId,
    name: config.name,
    api: 'openai-completions',
    provider,
    baseUrl: config.baseUrl.replace(/\/$/, ''),
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 32000,
    maxTokens: 4096,
  };
  models.setProvider(createProvider({
    id: provider,
    name: config.name,
    baseUrl: model.baseUrl,
    auth: { apiKey: { name: config.name, resolve: async () => ({ auth: { apiKey: config.apiKey }, source: 'server registry' }) } },
    models: [model],
    api: openAICompletionsApi(),
  }));
  return { models, model };
}

function getAgent(config: ModelConfig, tools: AgentTool[], systemPrompt: string) {
  const { models, model } = textModel(config);
  return new Agent({
    initialState: { systemPrompt, model, tools },
    streamFn: models.streamSimple.bind(models),
    toolExecution: 'sequential',
  });
}

export async function createPlanWithPi(prompt: string, config: ModelConfig, media: MediaItem[], history: ChatMessage[], previous: EditPlan | null, attached: MediaItem[] = []): Promise<EditPlan> {
  const sources = media.filter((item) => item.kind !== 'audio').map((item) => ({ id: item.id, name: item.name, kind: item.kind, duration: item.duration || null, shots: item.shots?.map((shot, index) => ({ number: index + 1, start: shot.start, end: shot.end })) }));
  let proposed: EditPlan | null = null;
  const schema = Type.Object({
    format: Type.Union([Type.Literal('9:16'), Type.Literal('16:9'), Type.Literal('1:1')]),
    summary: Type.String(),
    clips: Type.Array(Type.Object({ sourceId: Type.String(), start: Type.Number(), end: Type.Number() })),
    coverMediaId: Type.Optional(Type.String()),
  });
  const allowImageClips = /(?:图片|照片|插图|配图).{0,18}(?:作为片段|作为画面|放进视频|加入视频|做成视频)|(?:用|把|将).{0,18}(?:图片|照片|插图).{0,18}(?:视频片段|视频画面)|(?:image|photo|picture|illustration).{0,24}(?:clip|shot|video)|(?:clip|shot|video).{0,24}(?:image|photo|picture)/i.test(prompt);
  const attachedImageIds = new Set(attached.filter((item) => item.kind === 'image').map((item) => item.id));
  const tool: AgentTool<typeof schema> = {
    name: 'propose_edit', label: '提交剪辑方案',
    description: '提交使用真实素材、可由 FFmpeg 执行的剪辑片段与画幅。',
    parameters: schema,
    execute: async (_id, args) => {
      proposed = validatePlan({ ...args, targetSeconds: 0 }, media, allowImageClips, attachedImageIds);
      return { content: [{ type: 'text', text: '剪辑方案已通过素材与时长校验。' }], details: proposed };
    },
  };
  const context = history.slice(-12).map((message) => `${message.role === 'user' ? '用户' : '助手'}：${message.text}`).join('\n');
  const agent = getAgent(config, [tool], `你是轻剪的剪辑 Agent。必须调用 propose_edit 提交方案，不能只用文字回答。只能使用给出的 sourceId。每段至少 0.5 秒、最多 8 段、总长不超过 60 秒。shots 是 FFmpeg 自动检测的镜头边界；用户要求按分镜剪辑时，优先使用这些边界，并按用户要求选择、排序或拼接。图片素材只能从 0 秒开始，可持续 0.5 至 60 秒；${allowImageClips ? '用户明确要求图片进入视频画面，可用图片作片段。' : '用户没有明确要求图片进入视频画面，clips 只能用视频，图片只能作封面或视觉参考。'}如果当前消息附加图片且用户说“这张图片”或“所选图片”，必须使用所附图片的 ID，不能换成素材库中其他图片。视频片段不得超过素材时长。coverMediaId 仅在用户要求设置封面时填写真实图片 ID。默认 9:16，约 15 秒。没有画面理解能力，不可声称看过视频内容、识别精彩镜头或语义场景。素材：${JSON.stringify(sources)}。当前消息附件：${JSON.stringify(attached.map((item) => ({ id: item.id, name: item.name, kind: item.kind })))}。上一版方案：${JSON.stringify(previous)}。最近对话：${context}`);
  await agent.prompt(prompt);
  if (!proposed) throw new Error('Pi Agent 没有提交有效剪辑方案，请换一种说法重试。');
  return proposed;
}

export async function createNarrationWithPi(prompt: string, config: ModelConfig, history: ChatMessage[]): Promise<string> {
  let narration = '';
  const schema = Type.Object({ text: Type.String() });
  const tool: AgentTool<typeof schema> = {
    name: 'submit_narration', label: '提交口播文案',
    description: '提交可朗读的中文口播文案。', parameters: schema,
    execute: async (_id, args) => {
      narration = args.text.trim().slice(0, 1500);
      if (!narration) throw new Error('口播文案为空。');
      return { content: [{ type: 'text', text: '口播文案已提交。' }], details: { characters: narration.length } };
    },
  };
  const context = history.slice(-8).map((item) => `${item.role}：${item.text}`).join('\n');
  const agent = getAgent(config, [tool], `你是轻剪口播策划 Agent。根据用户要求写简洁自然的中文口播，必须调用 submit_narration。不要加入舞台说明或 markdown。最近对话：${context}`);
  await agent.prompt(prompt);
  if (!narration) throw new Error('未能生成口播文案，请重试。');
  return narration;
}

export async function createImagePromptWithPi(prompt: string, config: ModelConfig, history: ChatMessage[]): Promise<string> {
  let imagePrompt = '';
  const schema = Type.Object({ prompt: Type.String() });
  const tool: AgentTool<typeof schema> = {
    name: 'submit_image_prompt', label: '提交图片描述',
    description: '提交给图像模型使用的详细描述。', parameters: schema,
    execute: async (_id, args) => {
      imagePrompt = args.prompt.trim().slice(0, 1500);
      if (!imagePrompt) throw new Error('图片描述为空。');
      return { content: [{ type: 'text', text: '图片描述已提交。' }], details: { characters: imagePrompt.length } };
    },
  };
  const context = history.slice(-8).map((item) => `${item.role}：${item.text}`).join('\n');
  const agent = getAgent(config, [tool], `你是轻剪图片策划 Agent。将用户想要的封面或插图变成可生成的具体图片描述，保留用户明确指定的文字、风格和画幅。必须调用 submit_image_prompt。最近对话：${context}`);
  await agent.prompt(prompt);
  if (!imagePrompt) throw new Error('未能整理图片描述，请重试。');
  return imagePrompt;
}

export async function answerWithPi(prompt: string, config: ModelConfig, media: MediaItem[], history: ChatMessage[]): Promise<string> {
  let reply = '';
  const schema = Type.Object({ text: Type.String() });
  const tool: AgentTool<typeof schema> = {
    name: 'reply', label: '回复用户', description: '回复用户的问题或澄清需求。', parameters: schema,
    execute: async (_id, args) => {
      reply = args.text.trim().slice(0, 2000);
      return { content: [{ type: 'text', text: '已准备回复。' }], details: { characters: reply.length } };
    },
  };
  const sources = media.map((item) => ({ name: item.name, kind: item.kind, duration: item.duration }));
  const context = history.slice(-10).map((item) => `${item.role}：${item.text}`).join('\n');
  const agent = getAgent(config, [tool], `你是轻剪的对话助手。必须调用 reply。你可以帮助用户澄清剪辑意图，但不能声称已经完成剪辑、生成图片、生成口播或导出。没有画面理解能力。已有素材：${JSON.stringify(sources)}。最近对话：${context}`);
  await agent.prompt(prompt);
  if (!reply) throw new Error('暂时无法回复，请重试。');
  return reply;
}

export async function renderPlan(plan: EditPlan, media: MediaItem[], mediaDir: string, exportDir: string, narrationFile?: string, bgmFile?: string): Promise<{ id: string; file: string }> {
  const id = randomUUID();
  const tempDir = path.join(exportDir, `tmp-${id}`);
  await mkdir(tempDir, { recursive: true });
  const [width, height] = plan.format === '16:9' ? [960, 540] : plan.format === '1:1' ? [720, 720] : [540, 960];
  try {
    const segments: string[] = [];
    for (const [index, clip] of plan.clips.entries()) {
      const source = media.find((item) => item.id === clip.sourceId);
      if (!source) throw new Error('剪辑方案使用的素材已被移除。');
      const input = path.join(mediaDir, source.id);
      const segment = path.join(tempDir, `clip-${index}.mp4`);
      const duration = +(clip.end - clip.start).toFixed(2);
      const visual = source.kind === 'image'
        ? ['-loop', '1', '-framerate', '30', '-i', input]
        : ['-ss', String(clip.start), '-i', input];
      const hasAudio = source.kind === 'video' ? (await probeVideo(input)).hasAudio : false;
      const args = [
        '-hide_banner', '-loglevel', 'error', '-y', ...visual,
        ...(hasAudio ? [] : ['-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100']),
        '-t', String(duration), '-map', '0:v:0', '-map', hasAudio ? '0:a:0' : '1:a:0',
        '-vf', `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1,fps=30`,
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2', '-shortest', segment,
      ];
      await runFFmpeg(args);
      segments.push(segment);
    }
    const listFile = path.join(tempDir, 'concat.txt');
    await writeFile(listFile, segments.map((file) => `file '${file.replaceAll("'", "'\\''")}'`).join('\n'));
    const merged = path.join(tempDir, 'merged.mp4');
    await runFFmpeg(['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', '-movflags', '+faststart', merged]);
    const output = path.join(exportDir, `${id}.mp4`);
    if (narrationFile || bgmFile) {
      const inputs = ['-i', merged, ...(bgmFile ? ['-stream_loop', '-1', '-i', bgmFile] : []), ...(narrationFile ? ['-i', narrationFile] : [])];
      const tracks = ['[0:a]volume=' + (narrationFile ? '0.18' : bgmFile ? '0.2' : '0.25') + '[original]'];
      const labels = ['[original]'];
      if (bgmFile) { tracks.push('[1:a]volume=' + (narrationFile ? '0.24' : '0.36') + '[music]'); labels.push('[music]'); }
      if (narrationFile) { const index = bgmFile ? 2 : 1; tracks.push(`[${index}:a]volume=1[voice]`); labels.push('[voice]'); }
      tracks.push(`${labels.join('')}amix=inputs=${labels.length}:duration=first:dropout_transition=0[a]`);
      await runFFmpeg(['-hide_banner', '-loglevel', 'error', '-y', ...inputs,
        '-filter_complex', tracks.join(';'), '-map', '0:v:0', '-map', '[a]', '-t', String(plan.targetSeconds),
        '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', output]);
    } else await runFFmpeg(['-hide_banner', '-loglevel', 'error', '-y', '-i', merged, '-c', 'copy', output]);
    return { id, file: output };
  } finally { await rm(tempDir, { recursive: true, force: true }); }
}
