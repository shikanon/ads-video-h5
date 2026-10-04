import type { Express } from 'express';
import multer from 'multer';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { transcribe } from './audioUnderstanding';
import { runFFmpeg } from './core';
import { runWithJobSignal } from './jobExecution';
import { getModelConfig } from './modelRegistry';

export const MAX_VOICE_BYTES = 8 * 1024 * 1024;
export const MAX_VOICE_SECONDS = 60;
export class VoiceInputError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

// Decode the recording instead of trusting browser duration or WebM metadata
// (MediaRecorder WebM commonly has no duration in its container header).
export function voicePcm(wav: Buffer) {
  if (wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Invalid WAV');
  let samples: Buffer | undefined;
  let validFormat = false;
  for (let offset = 12; offset + 8 <= wav.length;) {
    const name = wav.toString('ascii', offset, offset + 4), size = wav.readUInt32LE(offset + 4), start = offset + 8;
    if (start + size > wav.length) throw new Error('Truncated WAV');
    if (name === 'fmt ' && size >= 16) validFormat = wav.readUInt16LE(start) === 1 && wav.readUInt16LE(start + 2) === 1 && wav.readUInt32LE(start + 4) === 16000 && wav.readUInt16LE(start + 14) === 16;
    if (name === 'data') samples = wav.subarray(start, start + size);
    offset = start + size + (size % 2);
  }
  if (!validFormat || !samples?.length || samples.length % 2) throw new Error('Invalid PCM');
  let sum = 0;
  for (let offset = 0; offset < samples.length; offset += 2) sum += (samples.readInt16LE(offset) / 32768) ** 2;
  return { duration: samples.length / 32000, rms: Math.sqrt(sum / (samples.length / 2)) };
}

export function voiceText(sentences: Array<{ text: string }>) {
  const text = sentences.map(sentence => sentence.text).join(' ').trim();
  if (!text) throw new VoiceInputError(422, 'NO_SPEECH', '没有识别到清晰语音，请靠近麦克风重新说一次。');
  if (text.length > 2000) throw new VoiceInputError(422, 'TOO_LONG', '语音指令过长，请分成两次说。');
  return text;
}

export async function recognizeVoice(bytes: Buffer, tmpDir: string) {
  const directory = await mkdtemp(path.join(tmpDir, 'voice-'));
  try {
    const input = path.join(directory, 'recording'), output = path.join(directory, 'speech.wav');
    await writeFile(input, bytes, { mode: 0o600 });
    try { await runFFmpeg(['-y', '-v', 'error', '-protocol_whitelist', 'file,pipe', '-format_whitelist', 'matroska,webm,mov,mp4,wav,mp3,ogg', '-i', input, '-map', '0:a:0', '-vn', '-t', String(MAX_VOICE_SECONDS + 2), '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', output], 20_000); }
    catch { throw new VoiceInputError(422, 'INVALID_AUDIO', '无法读取录音，请重新录制。'); }
    const wav = await readFile(output), pcm = voicePcm(wav);
    if (pcm.duration < 0.3) throw new VoiceInputError(422, 'TOO_SHORT', '录音太短，请长按按钮说出完整指令。');
    if (pcm.duration > MAX_VOICE_SECONDS + 0.5) throw new VoiceInputError(422, 'TOO_LONG', '一次最多录制 60 秒，请分成两次说。');
    if (pcm.rms < 0.0003) throw new VoiceInputError(422, 'NO_SPEECH', '录音静音或音量过低，请靠近麦克风重新说一次。');
    const config = await getModelConfig('understanding');
    if (!config) throw new VoiceInputError(503, 'UNCONFIGURED', '语音识别暂未配置，请联系管理员启用音频理解模型。');
    let sentences;
    try { sentences = await transcribe(wav, pcm.duration, config, false); }
    catch (error) {
      // A malformed timestamp/JSON can be corrected by re-listening; provider
      // authorization or network errors are not retried as transcript errors.
      if (!(error instanceof SyntaxError) && !/时间码|字词|句子格式|sentences/.test(error instanceof Error ? error.message : '')) throw error;
      sentences = await transcribe(wav, pcm.duration, config, true);
    }
    return { text: voiceText(sentences), duration: +pcm.duration.toFixed(3) };
  } finally { await rm(directory, { recursive: true, force: true }); }
}

export function mountVoiceInputRoutes(app: Express, tmpDir: string, recognize = recognizeVoice) {
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_VOICE_BYTES, files: 1, fields: 0 }, fileFilter: (_request, file, done) => {
    const type = file.mimetype.split(';')[0].toLowerCase();
    const allowed = ['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/mp3'];
    if (allowed.includes(type)) done(null, true);
    else done(new VoiceInputError(415, 'UNSUPPORTED_AUDIO', '录音格式不受支持，请换一个浏览器重试。'));
  } });
  app.post('/api/voice/transcribe', (request, response) => {
    upload.single('audio')(request, response, async error => {
      if (error) return response.status(error instanceof VoiceInputError ? error.status : error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: error instanceof VoiceInputError ? error.message : error.code === 'LIMIT_FILE_SIZE' ? '录音文件过大，请缩短录音。' : '请只上传一段录音。', code: error instanceof VoiceInputError ? error.code : 'INVALID_UPLOAD' });
      if (!request.file?.size) return response.status(400).json({ error: '请先录制语音。', code: 'MISSING_AUDIO' });
      const controller = new AbortController();
      const disconnected = () => { if (!response.writableFinished) controller.abort(); };
      response.once('close', disconnected);
      try {
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(90_000)]);
        const result = await runWithJobSignal(signal, () => recognize(request.file!.buffer, tmpDir));
        if (!controller.signal.aborted) response.json(result);
      } catch (cause) {
        if (!controller.signal.aborted) response.status(cause instanceof VoiceInputError ? cause.status : 503).json({ error: cause instanceof VoiceInputError ? cause.message : '语音识别暂时失败，请重新录制或使用文字输入。', code: cause instanceof VoiceInputError ? cause.code : 'RECOGNITION_FAILED' });
      } finally { response.off('close', disconnected); }
    });
  });
}
