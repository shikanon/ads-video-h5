import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createOssStorage, type AssetCategory } from '../server/ossStorage';
import type { Artifact, MediaItem } from '../src/types';

const dataDir = path.resolve(process.env.QINGJIAN_DATA_DIR || path.join(process.cwd(), 'data'));
const envFile = path.join(dataDir, 'oss.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);
const oss = createOssStorage();
if (!oss) throw new Error('OSS 环境变量未配置。');
const state = JSON.parse(await readFile(path.join(dataDir, 'app-state.json'), 'utf8')) as {
  media: MediaItem[]; artifacts: Artifact[]; artifactFiles: Record<string, string>;
};
let uploaded = 0;
let present = 0;
let missing = 0;
async function sync(ownerId: string | undefined, category: AssetCategory, id: string, file: string, mime: string) {
  if (!ownerId) throw new Error(`素材 ${id} 缺少 ownerId；先完成旧数据帐号归属迁移。`);
  if (!existsSync(file)) { missing++; return; }
  if (await oss.exists(ownerId, category, id)) { present++; return; }
  console.log(`Uploading ${category}/${id}`);
  await oss.put(ownerId, category, id, file, mime);
  uploaded++;
}
for (const item of state.media) {
  await sync(item.ownerId, 'media', item.id, path.join(dataDir, 'media', item.id), item.mimeType);
  for (let index = 0; index < (item.shots?.length || 0); index++) {
    await sync(item.ownerId, 'shots', `${item.id}-${index}`, path.join(dataDir, 'media', `${item.id}-shot-${index}.jpg`), 'image/jpeg');
  }
}
for (const item of state.artifacts) {
  if (item.kind === 'video') {
    await sync(item.ownerId, 'exports', item.id, path.join(dataDir, 'exports', `${item.id}.mp4`), 'video/mp4');
    if (item.coverMimeType) {
      const ext = item.coverMimeType === 'image/jpeg' ? 'jpg' : item.coverMimeType === 'image/png' ? 'png' : 'webp';
      await sync(item.ownerId, 'covers', item.id, path.join(dataDir, 'exports', `${item.id}-cover.${ext}`), item.coverMimeType);
    }
  } else {
    const name = state.artifactFiles[item.id];
    if (name) {
      const ext = path.extname(name).slice(1);
      const mime = item.kind === 'image' ? `image/${ext.replace('jpg', 'jpeg')}` : ext === 'wav' ? 'audio/wav' : ext === 'ogg' ? 'audio/ogg' : 'audio/mpeg';
      await sync(item.ownerId, 'artifacts', item.id, path.join(dataDir, 'artifacts', path.basename(name)), mime);
    }
  }
}
console.log(JSON.stringify({ bucket: oss.bucket, uploaded, present, missing }));
if (missing) process.exitCode = 2;
