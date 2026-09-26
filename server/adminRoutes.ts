import { Router, type Express, type Request, type Response } from 'express';
import {
  deleteModel,
  getDefaultTextModelId,
  isAdminToken,
  listAdminModels,
  setDefaultTextModelId,
  upsertModel,
  type ModelConfig,
} from './modelRegistry';
import type { createEffectStore, EffectValues, HtmlEffect } from './htmlEffects';

function message(error: unknown): string {
  return error instanceof Error ? error.message : '操作失败，请重试。';
}

function parseModel(body: unknown, id?: string): Partial<ModelConfig> & Pick<ModelConfig, 'name' | 'provider' | 'kind' | 'modelId' | 'baseUrl' | 'enabled'> {
  if (!body || typeof body !== 'object') throw new Error('请填写模型配置。');
  const input = body as Record<string, unknown>;
  const kind = input.kind;
  if (kind !== 'text' && kind !== 'image' && kind !== 'audio') throw new Error('模型用途必须是文本、图片或音频。');
  if (typeof input.name !== 'string' || typeof input.provider !== 'string' || typeof input.modelId !== 'string' || typeof input.baseUrl !== 'string' || typeof input.enabled !== 'boolean') {
    throw new Error('模型配置字段格式无效。');
  }
  if (input.apiKey !== undefined && typeof input.apiKey !== 'string') throw new Error('API Key 格式无效。');
  return {
    id,
    name: input.name,
    provider: input.provider,
    kind,
    modelId: input.modelId,
    baseUrl: input.baseUrl,
    enabled: input.enabled,
    apiKey: input.apiKey as string | undefined,
  };
}

export function mountAdminRoutes(app: Express, effects: ReturnType<typeof createEffectStore>): void {
  const router = Router();
  router.use(async (request: Request, response: Response, next) => {
    try {
      const token = /^Bearer (.+)$/i.exec(request.header('authorization') || '')?.[1] || '';
      if (!token || !(await isAdminToken(token))) {
        response.status(401).json({ error: '管理员令牌无效。' });
        return;
      }
      next();
    } catch (error) {
      response.status(500).json({ error: message(error) });
    }
  });

  router.get('/models', async (_request, response) => {
    try {
      response.json({ models: await listAdminModels(), defaultTextModelId: await getDefaultTextModelId() });
    } catch (error) {
      response.status(500).json({ error: message(error) });
    }
  });

  router.post('/models', async (request, response) => {
    try {
      const model = await upsertModel(parseModel(request.body));
      response.status(201).json({ model });
    } catch (error) {
      response.status(400).json({ error: message(error) });
    }
  });

  router.put('/models/:id', async (request, response) => {
    try {
      if (!(await listAdminModels()).some((model) => model.id === request.params.id)) {
        response.status(404).json({ error: '模型不存在。' });
        return;
      }
      const model = await upsertModel(parseModel(request.body, request.params.id));
      response.json({ model });
    } catch (error) {
      response.status(400).json({ error: message(error) });
    }
  });

  router.delete('/models/:id', async (request, response) => {
    try {
      await deleteModel(request.params.id);
      response.json({ ok: true });
    } catch (error) {
      response.status(400).json({ error: message(error) });
    }
  });

  router.put('/default-text-model', async (request, response) => {
    try {
      const id = request.body?.id;
      if (id !== null && typeof id !== 'string') throw new Error('模型 ID 格式无效。');
      await setDefaultTextModelId(id);
      response.json({ defaultTextModelId: await getDefaultTextModelId() });
    } catch (error) {
      response.status(400).json({ error: message(error) });
    }
  });

  router.get('/effects', (_request, response) => response.json({ effects: effects.list() }));
  router.get('/effects/renders', (_request, response) => response.json({ renders: effects.listRenders().map((render) => ({ id: render.id, effectId: render.effectId, status: render.status, createdAt: render.createdAt, error: render.error, downloadUrl: render.status === 'succeeded' ? `/api/admin/effects/renders/${render.id}/download` : undefined })) }));
  router.post('/effects/preview-draft', async (request, response) => {
    try { response.json({ html: await effects.compile(request.body?.effect as HtmlEffect, request.body?.values as Partial<EffectValues>, true) }); }
    catch (error) { response.status(400).json({ error: message(error) }); }
  });
  router.post('/effects', async (request, response) => {
    try { response.status(201).json({ effect: await effects.upsert(request.body as Partial<HtmlEffect>) }); }
    catch (error) { response.status(400).json({ error: message(error) }); }
  });
  router.put('/effects/:id', async (request, response) => {
    try { response.json({ effect: await effects.upsert(request.body as Partial<HtmlEffect>, request.params.id) }); }
    catch (error) { response.status(400).json({ error: message(error) }); }
  });
  router.delete('/effects/:id', async (request, response) => {
    try { await effects.remove(request.params.id); response.json({ ok: true }); }
    catch (error) { response.status(400).json({ error: message(error) }); }
  });
  router.post('/effects/:id/preview', async (request, response) => {
    try {
      const effect = effects.get(request.params.id);
      if (!effect) return response.status(404).json({ error: '特效不存在。' });
      response.json({ html: await effects.compile(effect, request.body?.values as Partial<EffectValues>, true) });
    } catch (error) { response.status(400).json({ error: message(error) }); }
  });
  router.post('/effects/:id/render', async (request, response) => {
    try {
      const effect = effects.get(request.params.id);
      if (!effect) return response.status(404).json({ error: '特效不存在。' });
      response.status(202).json({ render: await effects.render(effect, request.body?.values as Partial<EffectValues>) });
    } catch (error) { response.status(400).json({ error: message(error) }); }
  });
  router.get('/effects/renders/:id', (request, response) => {
    const render = effects.getRender(request.params.id);
    if (!render) return response.status(404).json({ error: '渲染任务不存在。' });
    response.json({ render: { id: render.id, effectId: render.effectId, status: render.status, createdAt: render.createdAt, error: render.error, downloadUrl: render.status === 'succeeded' ? `/api/admin/effects/renders/${render.id}/download` : undefined } });
  });
  router.get('/effects/renders/:id/download', (request, response) => {
    const render = effects.getRender(request.params.id);
    if (!render || render.status !== 'succeeded' || !render.file) return response.status(404).json({ error: '视频尚未生成。' });
    response.download(render.file, `qingjian-effect-${render.id}.mp4`);
  });

  app.use('/api/admin', router);
}
