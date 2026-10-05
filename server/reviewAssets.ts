import { randomUUID } from 'node:crypto';
import type { createOssStorage } from './ossStorage';
import type { ModelConfig } from './modelRegistry';
import { isEvaluationOwner } from './evaluationIsolation';
import { jobFetch, throwIfJobCancelled } from './jobExecution';

export type ReviewAssetPublisher = (file: string, mimeType: 'audio/mpeg' | 'image/jpeg') => Promise<string>;
export type ReviewRequestMetric = { stage: 'voice' | 'semantic'; attempt: number; bytes: number; durationMs: number; status?: number; error?: string };
export type ReviewObserver = (metric: ReviewRequestMetric) => void;

export async function withReviewAssets<T>(storage: ReturnType<typeof createOssStorage>, owner: string, run: (publish?: ReviewAssetPublisher) => Promise<T>): Promise<T> {
  const probe = `review-${randomUUID()}`;
  if (!storage || isEvaluationOwner(owner) || !storage.publicUrl(owner, 'artifacts', probe)) return run();
  const ids: string[] = [];
  const publish: ReviewAssetPublisher = async (file, mimeType) => {
    throwIfJobCancelled();
    const id = `review-${randomUUID()}.${mimeType === 'audio/mpeg' ? 'mp3' : 'jpg'}`;
    const url = storage.publicUrl(owner, 'artifacts', id)!;
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('审查媒体地址无效。');
    ids.push(id);
    try { await storage.put(owner, 'artifacts', id, file, mimeType); }
    catch { throwIfJobCancelled(); throw new Error('审查媒体传输未完成。'); }
    throwIfJobCancelled();
    return url;
  };
  try { return await run(publish); }
  finally { await Promise.allSettled(ids.map(id => storage.remove(owner, 'artifacts', id))); }
}

// Observe request sizes and timings, never credentials, bodies or media URLs.
export async function requestReviewJson(config: ModelConfig, payload: unknown, stage: ReviewRequestMetric['stage'], attempt: number, observe?: ReviewObserver): Promise<any> {
  const body = JSON.stringify(payload), start = Date.now();
  let status: number | undefined, errorType: string | undefined;
  try {
    const response = await jobFetch(config.baseUrl.replace(/\/$/, '') + '/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer ' + config.apiKey, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(180000), body });
    status = response.status;
    if (!response.ok) throw new Error(`HTTP ${status}`);
    return await response.json();
  } catch (error) {
    errorType = error instanceof Error ? /^HTTP \d+$/.test(error.message) ? error.message : error.name : 'ProviderError';
    throw error;
  } finally {
    observe?.({ stage, attempt: attempt + 1, bytes: Buffer.byteLength(body), durationMs: Date.now() - start, ...(status === undefined ? {} : { status }), ...(errorType ? { error: errorType } : {}) });
  }
}
