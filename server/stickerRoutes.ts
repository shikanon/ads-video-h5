import type { Express } from 'express';
import path from 'node:path';
import { userOf, type PublicUser } from './auth';
import { loadStickerPack, publicStickerPack, stickerAssets, validateStickerTask } from './stickerPacks';
import type { StickerTask } from '../shared/stickerPacks';

/** Only curated sample renditions are public; account deliveries use artifact ownership checks. */
export function mountStickerSamples(app: Express) {
  app.get('/api/sticker-packs/:packId/items/:id/:kind', async (q, r) => {
    const pack = await loadStickerPack();
    const file = q.params.kind === 'thumb' ? 'thumb.png' : q.params.kind === 'preview' ? 'animation.gif' : undefined;
    if (q.params.packId !== pack.id || !pack.items.some(item => item.id === q.params.id) || !file) return r.status(404).json({error:'表情不存在。'});
    r.sendFile(path.join(stickerAssets, 'pack', q.params.id, file), { maxAge: '1h' });
  });
}
export function mountStickerRoutes(app: Express, o: {
  base: string;
  start: (user: PublicUser, sessionId: string, requestId: string, task: StickerTask) => Promise<unknown>;
}) {
  app.get('/api/sticker-packs', async (_q,r) => r.json({ packs: [publicStickerPack(await loadStickerPack())] }));
  app.post('/api/sticker-packs/:packId/jobs', async (q,r) => {
    try {
      const pack = await loadStickerPack();
      if(q.params.packId !== pack.id) return r.status(404).json({error:'表情套装不存在。'});
      const {sessionId, requestId, task} = q.body || {};
      if(typeof sessionId !== 'string' || !/^[a-f0-9-]{36}$/.test(sessionId) ||
         typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{16,80}$/.test(requestId) ||
         Object.keys(q.body).some(k => !['sessionId','requestId','task'].includes(k))) throw new Error('制作请求无效。');
      const validated = validateStickerTask(task, pack);
      r.status(202).json(await o.start(userOf(q),sessionId,requestId,validated));
    } catch(error) { r.status((error as {status?:number}).status || 400).json({error:error instanceof Error ? error.message : '表情制作未能开始。'}); }
  });
}
