import { Router, type Express } from 'express';
import { userOf, type PublicUser } from './auth';
import type { AdminAuth } from './adminAuth';
import type { Credits } from './credits';
import { validateTokenPrice } from './tokenPricing';

const pagination = (query: Record<string, unknown>) => ({
  offset: Math.max(0, Math.min(1_000_000, Math.trunc(Number(query.offset) || 0))),
  limit: Math.max(1, Math.min(100, Math.trunc(Number(query.limit) || 20))),
});
export function mountCreditRoutes(app: Express, credits: Credits) {
  app.get('/api/credits', async (request, response) => {
    const { offset, limit } = pagination(request.query);
    response.set('Cache-Control', 'no-store').json(await credits.history(userOf(request).id, offset, limit));
  });
  app.post('/api/credits/check-in', async (request, response) => {
    if (typeof request.body?.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(request.body.date)) return response.status(400).json({ error: '请提供当前签到日期。' });
    response.set('Cache-Control', 'no-store').json(await credits.checkIn(userOf(request).id, request.body.date));
  });
}
export function mountCreditAdminRoutes(app: Express, credits: Credits, admin: AdminAuth, users: () => PublicUser[]) {
  const router = Router();
  router.use(admin.requireAdmin);
  router.get('/', async (_request, response) => response.set('Cache-Control', 'no-store').json(await credits.adminState(users())));
  router.patch('/users/:id', async (request, response) => {
    if (!users().some(u => u.id === request.params.id)) return response.status(404).json({ error: '用户不存在。' });
    if (typeof request.body?.special !== 'boolean') return response.status(400).json({ error: '请明确指定是否为特殊账户。' });
    response.json({ wallet: await credits.setSpecial(request.params.id, request.body.special) });
  });
  router.get('/users/:id/ledger', async (request, response) => {
    if (!users().some(u => u.id === request.params.id)) return response.status(404).json({ error: '用户不存在。' });
    const { offset, limit } = pagination(request.query);
    response.set('Cache-Control', 'no-store').json(await credits.history(request.params.id, offset, limit));
  });
  router.put('/prices/:modelId', async (request, response, next) => {
    let input;
    try { input = validateTokenPrice({ ...request.body, modelId: request.params.modelId }); }
    catch (error) { return response.status(400).json({ error: error instanceof Error ? error.message : '价格无效。' }); }
    try { response.json({ price: await credits.setPrice(input) }); } catch (error) { next(error); }
  });
  app.use('/api/admin/credits', router);
}
