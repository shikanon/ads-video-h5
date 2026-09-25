import express, { type ErrorRequestHandler } from 'express';
import multer from 'multer';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpegPath from 'ffmpeg-static';
import { Agent, type AgentTool } from '@earendil-works/pi-agent-core';
import { createModels } from '@earendil-works/pi-ai';
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai';
import { Type } from 'typebox';
import type { ChatMessage, EditPlan, Format, MediaItem, ProjectState } from '../src/types';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, 'data');
const mediaDir = path.join(dataDir, 'media');
const exportsDir = path.join(dataDir, 'exports');
const projectFile = path.join(dataDir, 'project.json');
const isPiEnabled = Boolean(process.env.OPENAI_API_KEY);
const port = Number(process.env.PORT || 8787);

if (!ffmpegPath) throw new Error('FFmpeg binary is unavailable for this platform.');
await Promise.all([mkdir(mediaDir, { recursive: true }), mkdir(exportsDir, { recursive: true })]);

const emptyProject = (): ProjectState => ({
  media: [],
  messages: [],
  plan: null,
  exportId: null,
  mode: isPiEnabled ? 'pi' : 'demo',
});

let project: ProjectState = await readFile(projectFile, 'utf8')
  .then((text) => ({ ...emptyProject(), ...JSON.parse(text) as Partial<ProjectState> }))
  .catch(() => emptyProject());
project.mode = isPiEnabled ? 'pi' : 'demo';
let isPlanning = false;
let isRendering = false;

async function saveProject() {
  await writeFile(projectFile, JSON.stringify(project, null, 2));
}

function publicProject(): ProjectState {
  return { ...project, media: project.media.map((item) => ({ ...item, url: `/api/media/${item.id}` })) };
}

function sourcePath(id: string) {
  return path.join(mediaDir, id);
}

function runFFmpeg(args: string[], timeoutMs = 120_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath!, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-12_000); });
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stderr);
      else reject(new Error(stderr || `FFmpeg exited with code ${code ?? 'unknown'}`));
    });
  });
}

async function probeVideo(file: string): Promise<{ duration: number; hasAudio: boolean }> {
  let stderr = '';
  try {
    stderr = await runFFmpeg(['-hide_banner', '-i', file]);
  } catch (error) {
    stderr = error instanceof Error ? error.message : String(error);
  }
  const match = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!match || !/Video:/.test(stderr)) throw new Error('无法读取视频时长或画面，请换一个视频文件。');
  const duration = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  if (!Number.isFinite(duration) || duration < 0.5) throw new Error('视频时长太短，无法剪辑。');
  return { duration, hasAudio: /Audio:/.test(stderr) };
}

function validatePlan(input: EditPlan): EditPlan {
  const formats: Format[] = ['9:16', '16:9', '1:1'];
  if (!formats.includes(input.format)) throw new Error('不支持的成片比例。');
  if (!Array.isArray(input.clips) || input.clips.length < 1 || input.clips.length > 8) {
    throw new Error('请选择 1 到 8 个片段。');
  }
  const clips = input.clips.map((clip) => {
    const media = project.media.find((item) => item.id === clip.sourceId);
    if (!media) throw new Error('剪辑方案引用了不存在的素材。');
    const start = Number(clip.start);
    const end = Number(clip.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end - start < 0.5 || end > media.duration + 0.05) {
      throw new Error(`片段时间超出素材「${media.name}」的范围。`);
    }
    return { sourceId: clip.sourceId, start: +start.toFixed(2), end: +Math.min(end, media.duration).toFixed(2) };
  });
  const total = clips.reduce((sum, clip) => sum + clip.end - clip.start, 0);
  if (total > 60.05) throw new Error('成片最长为 60 秒。');
  return {
    format: input.format,
    targetSeconds: +total.toFixed(1),
    summary: String(input.summary || '已整理剪辑方案').slice(0, 120),
    clips,
  };
}

function demoPlan(prompt: string): EditPlan {
  const requested = prompt.match(/(\d{1,2})\s*秒/);
  const seconds = Math.min(60, Math.max(3, requested ? Number(requested[1]) : 15));
  const format: Format = /横屏|16\s*[:：]\s*9/.test(prompt) ? '16:9' : /方形|1\s*[:：]\s*1/.test(prompt) ? '1:1' : '9:16';
  let remaining = seconds;
  const clips: EditPlan['clips'] = [];
  for (const media of project.media) {
    if (remaining < 0.5 || clips.length >= 8) break;
    const end = Math.min(media.duration, remaining);
    if (end >= 0.5) {
      clips.push({ sourceId: media.id, start: 0, end: +end.toFixed(2) });
      remaining -= end;
    }
  }
  return validatePlan({ format, targetSeconds: seconds, summary: `按上传顺序选取片段，制作约 ${Math.round(seconds - remaining)} 秒${format}视频。`, clips });
}

async function piPlan(prompt: string): Promise<EditPlan> {
  const models = createModels();
  models.setProvider(openaiProvider());
  const modelName = process.env.PI_MODEL || 'gpt-5-mini';
  const model = models.getModel('openai', modelName);
  if (!model) throw new Error(`Pi Agent 找不到模型 ${modelName}。`);

  let proposed: EditPlan | null = null;
  const proposeSchema = Type.Object({
    format: Type.Union([Type.Literal('9:16'), Type.Literal('16:9'), Type.Literal('1:1')]),
    summary: Type.String(),
    clips: Type.Array(Type.Object({
      sourceId: Type.String(),
      start: Type.Number(),
      end: Type.Number(),
    })),
  });
  const proposeTool: AgentTool<typeof proposeSchema> = {
    name: 'propose_edit',
    label: '制作剪辑方案',
    description: '根据真实视频素材和用户要求，提交可用 FFmpeg 执行的剪辑片段与比例。',
    parameters: proposeSchema,
    execute: async (_id, params) => {
      proposed = validatePlan({ ...params, targetSeconds: 0 });
      return { content: [{ type: 'text', text: '剪辑方案已通过素材与时长校验。' }], details: proposed };
    },
  };
  const history = project.messages.slice(-8).map((message) => `${message.role === 'user' ? '用户' : '助手'}：${message.text}`).join('\n');
  const sources = project.media.map((item) => ({ id: item.id, name: item.name, duration: +item.duration.toFixed(2) }));
  const agent = new Agent({
    initialState: {
      systemPrompt: `你是轻剪的视频剪辑策划助手。使用 propose_edit 工具提交方案，不要声称看过视频内容；你只知道文件名和时长。只能引用下列 sourceId，片段起止时间必须在对应素材时长内，每段至少 0.5 秒，总时长不超过 60 秒。优先满足用户说的比例、时长和素材顺序。默认 9:16、15 秒。若用户要求无法从文件名和时长确认的精彩镜头，说明这是按时间均匀选段，不能假称已识别内容。素材：${JSON.stringify(sources)}。最近对话：${history}`,
      model,
      tools: [proposeTool],
    },
    streamFn: models.streamSimple.bind(models),
    toolExecution: 'sequential',
  });
  await agent.prompt(prompt);
  if (!proposed) throw new Error('Pi Agent 没有给出有效的剪辑方案，请换一种说法重试。');
  return proposed;
}

async function renderPlan(plan: EditPlan): Promise<string> {
  const id = randomUUID();
  const tempDir = path.join(dataDir, 'tmp', id);
  await mkdir(tempDir, { recursive: true });
  const [width, height] = plan.format === '16:9' ? [960, 540] : plan.format === '1:1' ? [720, 720] : [540, 960];
  try {
    const files: string[] = [];
    for (const [index, clip] of plan.clips.entries()) {
      const input = sourcePath(clip.sourceId);
      const { hasAudio } = await probeVideo(input);
      const segment = path.join(tempDir, `clip-${index}.mp4`);
      const duration = +(clip.end - clip.start).toFixed(2);
      const args = [
        '-hide_banner', '-loglevel', 'error', '-y', '-ss', String(clip.start), '-i', input,
        ...(hasAudio ? [] : ['-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100']),
        '-t', String(duration), '-map', '0:v:0', '-map', hasAudio ? '0:a:0' : '1:a:0',
        '-vf', `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1,fps=30`,
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2', '-shortest', segment,
      ];
      await runFFmpeg(args, 180_000);
      files.push(segment);
    }
    const listFile = path.join(tempDir, 'concat.txt');
    await writeFile(listFile, files.map((file) => `file '${file.replaceAll("'", "'\\''")}'`).join('\n'));
    const output = path.join(exportsDir, `${id}.mp4`);
    await runFFmpeg(['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', '-movflags', '+faststart', output], 180_000);
    return id;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

const app = express();
app.use(express.json({ limit: '128kb' }));

const upload = multer({
  storage: multer.diskStorage({
    destination: mediaDir,
    filename: (_request, _file, callback) => callback(null, randomUUID()),
  }),
  limits: { fileSize: 300 * 1024 * 1024, files: 6 },
  fileFilter: (_request, file, callback) => callback(null, file.mimetype.startsWith('video/')),
});

app.get('/api/project', (_request, response) => response.json(publicProject()));

app.post('/api/media', upload.array('videos', 6), async (request, response) => {
  const files = (request.files || []) as Express.Multer.File[];
  if (!files.length) return response.status(400).json({ error: '请选择视频文件。' });
  try {
    const items: MediaItem[] = [];
    for (const file of files) {
      const { duration } = await probeVideo(file.path);
      const item = { id: file.filename, name: file.originalname.slice(0, 100), mimeType: file.mimetype, duration, url: `/api/media/${file.filename}` };
      items.push(item);
    }
    project.media.push(...items);
    project.plan = null;
    project.exportId = null;
    await saveProject();
    response.json(publicProject());
  } catch (error) {
    await Promise.all(files.map((file) => rm(file.path, { force: true })));
    response.status(400).json({ error: error instanceof Error ? error.message : '视频解析失败。' });
  }
});

app.delete('/api/media/:id', async (request, response) => {
  const item = project.media.find((media) => media.id === request.params.id);
  if (!item) return response.status(404).json({ error: '素材不存在。' });
  project.media = project.media.filter((media) => media.id !== item.id);
  project.plan = null;
  project.exportId = null;
  await Promise.all([rm(sourcePath(item.id), { force: true }), saveProject()]);
  response.json(publicProject());
});

app.get('/api/media/:id', (request, response) => {
  const item = project.media.find((media) => media.id === request.params.id);
  if (!item) return response.sendStatus(404);
  response.type(item.mimeType || 'application/octet-stream').sendFile(sourcePath(item.id));
});

app.post('/api/chat', async (request, response) => {
  const prompt = String(request.body?.message || '').trim().slice(0, 1000);
  if (!prompt) return response.status(400).json({ error: '先说说你想怎么剪。' });
  if (!project.media.length) return response.status(400).json({ error: '请先上传至少一段视频。' });
  if (isPlanning) return response.status(409).json({ error: '上一条剪辑需求还在处理。' });
  isPlanning = true;
  try {
    const plan = isPiEnabled ? await piPlan(prompt) : demoPlan(prompt);
    project.plan = plan;
    project.exportId = null;
    const reply = isPiEnabled
      ? `${plan.summary} 已整理 ${plan.clips.length} 个片段，确认后可生成成片。`
      : `演示模式已按时间整理 ${plan.clips.length} 个片段。配置 OPENAI_API_KEY 后，Pi Agent 可理解更细的剪辑要求。`;
    project.messages.push({ role: 'user', text: prompt }, { role: 'assistant', text: reply });
    await saveProject();
    response.json(publicProject());
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : '剪辑方案生成失败。' });
  } finally {
    isPlanning = false;
  }
});

app.post('/api/export', async (_request, response) => {
  if (!project.plan) return response.status(400).json({ error: '请先通过对话生成剪辑方案。' });
  if (isRendering) return response.status(409).json({ error: '正在生成视频，请稍候。' });
  isRendering = true;
  try {
    project.exportId = await renderPlan(project.plan);
    await saveProject();
    response.json(publicProject());
  } catch (error) {
    console.error('Video export failed:', error);
    response.status(500).json({ error: '视频生成失败，请检查素材格式后重试。' });
  } finally {
    isRendering = false;
  }
});

app.get('/api/export/:id', (request, response) => {
  if (request.params.id !== project.exportId) return response.sendStatus(404);
  response.type('video/mp4').sendFile(path.join(exportsDir, `${project.exportId}.mp4`));
});

app.get('/api/download/:id', (request, response) => {
  if (request.params.id !== project.exportId) return response.sendStatus(404);
  response.download(path.join(exportsDir, `${project.exportId}.mp4`), 'qingjian-export.mp4');
});

app.use(((error, _request, response, _next) => {
  if (error instanceof multer.MulterError) {
    const message = error.code === 'LIMIT_FILE_SIZE' ? '单个视频不能超过 300 MB。' : '一次最多上传 6 个视频。';
    response.status(400).json({ error: message });
    return;
  }
  response.status(500).json({ error: '处理请求时出错，请重试。' });
}) satisfies ErrorRequestHandler);

app.use(express.static(path.join(root, 'dist')));
app.get('/{*path}', (_request, response) => response.sendFile(path.join(root, 'dist', 'index.html')));
app.listen(port, '127.0.0.1', () => console.log(`轻剪 API listening on http://127.0.0.1:${port} (${isPiEnabled ? 'Pi Agent' : 'demo'} mode)`));
