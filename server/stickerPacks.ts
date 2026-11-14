import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import type { StickerPack, StickerTask } from '../shared/stickerPacks';
import { fileDigest } from './artifactIntegrity';

export const stickerDirectory = fileURLToPath(new URL('../skills/qingmao-stickers/', import.meta.url));
export const stickerAssets = path.join(stickerDirectory, 'assets');
export interface PackManifest {
  id: string; name: string; version: string;
  items: Array<{ id: string; name: string; action: string; durations: number[]; frameSize: number; columns: number; rows: number }>;
  defaultSceneIds: string[];
  files: Record<string, string>;
}
export const defaultCaptions = ['今天，电量有点低。', '那就，陪陪我嘛。', '摸摸头，烦恼退退。', '手给你，一起走呀。', '再靠近，一点点。', '好啦，又心动了。'];
export async function loadStickerPack(): Promise<PackManifest> {
  const pack: PackManifest = JSON.parse(await readFile(path.join(stickerAssets, 'pack.json'), 'utf8'));
  if (pack.id !== 'qingmao-affection-v1' || pack.version !== '1.0.0' || pack.items.length !== 24 ||
      new Set(pack.items.map(item => item.id)).size !== 24 || pack.items.some(item => !/^\d{2}$/.test(item.id) ||
        !item.name || item.durations.length !== 10 || item.durations.some(ms => !Number.isInteger(ms) || ms < 40 || ms > 2000) ||
        item.frameSize !== 512 || item.columns !== 5 || item.rows !== 2)) throw new Error('表情素材清单无效。');
  return pack;
}
export function publicStickerPack(pack: PackManifest, base = ''): StickerPack {
  return { id: pack.id, name: pack.name, version: pack.version, count: pack.items.length,
    defaultSceneIds: pack.defaultSceneIds,
    sampleUrl: `${base}/api/templates/qingmao-stickers/sample/video`,
    posterUrl: `${base}/api/templates/qingmao-stickers/sample/poster`,
    items: pack.items.map(({ id, name, action, durations }) => ({ id, name, action, durations,
      thumbnailUrl: `${base}/api/sticker-packs/${pack.id}/items/${id}/thumb`,
      previewUrl: `${base}/api/sticker-packs/${pack.id}/items/${id}/preview` })),
  };
}
export function validateStickerTask(value: unknown, pack: PackManifest): StickerTask {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('表情制作参数无效。');
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some(k => !['packId','title','makeVideo','bgm','sceneIds','captions'].includes(k)) ||
      v.packId !== pack.id || typeof v.title !== 'string' || !v.title.trim() || [...v.title.trim()].length > 16 ||
      /[\x00-\x1f\x7f]/.test(v.title) || typeof v.makeVideo !== 'boolean' || typeof v.bgm !== 'boolean' ||
      !Array.isArray(v.sceneIds) || v.sceneIds.length !== 6 || new Set(v.sceneIds).size !== 6 ||
      v.sceneIds.some(id => typeof id !== 'string' || !pack.items.some(item => item.id === id)) ||
      !Array.isArray(v.captions) || v.captions.length !== 6 || v.captions.some(line => typeof line !== 'string' ||
        !line.trim() || [...line.trim()].length > 18 || /[\x00-\x1f\x7f]/.test(line))) throw new Error('请选择6个不同动作，片名最多16字，每幕短句最多18字。');
  return { packId: pack.id, title: v.title.trim(), makeVideo: v.makeVideo, bgm: v.bgm,
    sceneIds: [...v.sceneIds] as string[], captions: (v.captions as string[]).map(line => line.trim()) };
}
export function defaultStickerTask(pack: PackManifest): StickerTask {
  return { packId: pack.id, title: '被你哄好的一天', makeVideo: true, bgm: true,
    sceneIds: [...pack.defaultSceneIds], captions: [...defaultCaptions] };
}
export async function verifyStickerAssets(pack: PackManifest) {
  const hash = createHash('sha256');
  for (const [relative, expected] of Object.entries(pack.files).sort(([a],[b]) => a.localeCompare(b))) {
    if (!/^(?:pack\/\d{2}\/(?:animation\.(?:gif|webp|png)|still\.png|thumb\.png|atlas\.webp)|music\.wav|sample\.mp4|poster\.png|banner\.jpg|album\.png|icon\.png|album\.json)$/.test(relative)) throw new Error('表情素材路径无效。');
    const actual = await fileDigest(path.join(stickerAssets, relative));
    if (actual !== expected) throw new Error('表情素材已变化，请重新导入并确认版本。');
    hash.update(relative).update(actual);
  }
  for (const item of pack.items) for (const file of ['animation.gif','animation.webp','animation.png','still.png','thumb.png','atlas.webp']) {
    if (!pack.files[`pack/${item.id}/${file}`]) throw new Error('表情素材清单不完整。');
  }
  for(const file of ['music.wav','sample.mp4','poster.png','banner.jpg','album.png','icon.png','album.json'])if(!pack.files[file])throw new Error('专辑配套素材清单不完整。');
  return hash.update(JSON.stringify(pack)).digest('hex');
}
