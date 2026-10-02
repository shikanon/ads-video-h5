import { access } from 'node:fs/promises';
import type { createOssStorage } from './ossStorage';

export const isEvaluationOwner = (ownerId?: string) => Boolean(ownerId?.startsWith('evaluation:'));
// Evaluation inputs and outputs stay behind admin authentication even when the
// ordinary media bucket is public. All normal-user storage calls are delegated.
export function privateEvaluationStorage(storage: ReturnType<typeof createOssStorage>): ReturnType<typeof createOssStorage> {
  if (!storage) return null;
  return {
    ...storage,
    publicUrl: (...args) => isEvaluationOwner(args[0]) ? null : storage.publicUrl(...args),
    put: async (...args) => { if (!isEvaluationOwner(args[0])) await storage.put(...args); },
    ensure: async (...args) => { if (isEvaluationOwner(args[0])) await access(args[3]); else await storage.ensure(...args); },
    remove: async (...args) => { if (!isEvaluationOwner(args[0])) await storage.remove(...args); },
    exists: async (...args) => !isEvaluationOwner(args[0]) && storage.exists(...args),
  };
}
