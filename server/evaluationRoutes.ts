import type { Router, Response } from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { MAX_MEDIA_UPLOAD_BYTES } from '../src/uploadLimits';
import { EvaluationError, type Evaluations } from './evaluations';

// Mounted inside the existing admin-token middleware; no token-bearing URLs.
export function mountEvaluationRoutes(router: Router, evaluations: Evaluations) {
  const upload = multer({ storage: multer.diskStorage({ destination: evaluations.uploadsDir, filename: (_r, _f, done) => done(null, randomUUID()) }), limits: { fileSize: MAX_MEDIA_UPLOAD_BYTES, files: 1 }, fileFilter: (_r, file, done) => file.mimetype.startsWith('video/') ? done(null, true) : done(new EvaluationError('评测素材仅支持视频文件。')) });
  async function respond(response: Response, action: () => unknown | Promise<unknown>, status = 200) {
    try { response.status(status).json(await action()); }
    catch (error) { response.status(error instanceof EvaluationError ? error.status : 500).json({ error: error instanceof EvaluationError ? error.message : '评测操作失败，请检查服务端记录。' }); }
  }
  router.get('/evaluations/cases', (_r, response) => response.json(evaluations.catalog()));
  router.post('/evaluations/cases', (request, response) => respond(response, async () => ({ case: await evaluations.upsert(request.body) }), 201));
  router.put('/evaluations/cases/:id', (request, response) => respond(response, async () => ({ case: await evaluations.upsert(request.body, request.params.id) })));
  router.post('/evaluations/fixtures', (request, response) => {
    upload.single('file')(request, response, async error => {
      if (error) return response.status(400).json({ error: error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE' ? '每段视频不能超过100 MB。' : '请选择有效视频文件。' });
      if (!request.file) return response.status(400).json({ error: '请选择评测视频。' });
      const file = request.file;
      try { await respond(response, async () => ({ fixture: await evaluations.saveFixture(file.path, file.originalname) }), 201); }
      finally { await rm(file.path, { force: true }).catch(() => undefined); }
    });
  });
  router.get('/evaluations/runs', (_r, response) => response.json({ runs: evaluations.list() }));
  router.post('/evaluations/runs', (request, response) => respond(response, async () => ({ run: await evaluations.start(request.body) }), 202));
  router.get('/evaluations/runs/:id', (request, response) => respond(response, () => ({ run: evaluations.get(request.params.id) })));
  router.post('/evaluations/runs/:id/stop', (request, response) => respond(response, async () => ({ run: await evaluations.stop(request.params.id) }), 202));
  router.get('/evaluations/runs/:id/report', (request, response) => {
    try { response.attachment(`qingjian-evaluation-${request.params.id}.json`).json(evaluations.get(request.params.id)); }
    catch (error) { response.status(error instanceof EvaluationError ? error.status : 500).json({ error: '评测记录不存在。' }); }
  });
  router.put('/evaluations/runs/:id/results/:resultId/human-review', (request, response) => respond(response, async () => ({ result: await evaluations.humanReview(request.params.id, request.params.resultId, request.body) })));
  router.get('/evaluations/runs/:id/results/:resultId/video', (request, response) => {
    try { response.type('video/mp4').sendFile(evaluations.videoFile(request.params.id, request.params.resultId)); }
    catch (error) { response.status(error instanceof EvaluationError ? error.status : 500).json({ error: '成片尚未生成或无法读取。' }); }
  });
}
