import OSS from 'ali-oss';
import { randomUUID } from 'node:crypto';
import { access, mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';

export type AssetCategory = 'media' | 'artifacts' | 'exports' | 'covers' | 'shots';

export function createOssStorage() {
  const names = ['OSS_ACCESS_KEY_ID', 'OSS_ACCESS_KEY_SECRET', 'OSS_REGION', 'OSS_BUCKET'] as const;
  const configured = names.filter((name) => Boolean(process.env[name]));
  if (!configured.length) return null;
  if (configured.length !== names.length) throw new Error(`OSS 配置不完整：缺少 ${names.filter((name) => !process.env[name]).join(', ')}`);
  const region = process.env.OSS_REGION!;
  const bucket = process.env.OSS_BUCKET!;
  const prefix = (process.env.OSS_PREFIX || 'qingjian').replace(/^\/+|\/+$/g, '');
  const client = new OSS({
    region, bucket, secure: true, authorizationV4: true, timeout: 180_000,
    accessKeyId: process.env.OSS_ACCESS_KEY_ID!,
    accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET!,
  });
  const key = (ownerId: string, category: AssetCategory, id: string) => `${prefix}/users/${ownerId}/${category}/${id}`;
  return {
    bucket,
    key,
    async put(ownerId: string, category: AssetCategory, id: string, file: string, mimeType: string) {
      const name = key(ownerId, category, id);
      const headers = { 'Content-Type': mimeType, 'x-oss-object-acl': 'private' };
      if ((await stat(file)).size >= 5 * 1024 * 1024) await client.multipartUpload(name, file, { partSize: 512 * 1024, parallel: 2, timeout: 180_000, mime: mimeType, headers });
      else await client.put(name, file, { timeout: 180_000, mime: mimeType, headers });
    },
    async ensure(ownerId: string, category: AssetCategory, id: string, file: string) {
      try { await access(file); return; } catch { /* Restore the local processing cache. */ }
      await mkdir(path.dirname(file), { recursive: true });
      const temp = `${file}.${randomUUID()}.download`;
      try {
        await client.get(key(ownerId, category, id), temp);
        await rename(temp, file);
      } catch (error) {
        await rm(temp, { force: true });
        throw error;
      }
    },
    async remove(ownerId: string, category: AssetCategory, id: string) {
      await client.delete(key(ownerId, category, id));
    },
    async exists(ownerId: string, category: AssetCategory, id: string) {
      try { await client.head(key(ownerId, category, id)); return true; }
      catch (error) { if ((error as { status?: number }).status === 404) return false; throw error; }
    },
  };
}
