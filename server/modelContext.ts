import { AsyncLocalStorage } from 'node:async_hooks';
import type { ModelConfig } from './modelRegistry';
import type { ModelKind } from '../src/types';

export type ModelSnapshot = Record<ModelKind, ModelConfig | null>;
const context = new AsyncLocalStorage<ModelSnapshot>();
export function withModelSnapshot<T>(models: ModelSnapshot, action: () => Promise<T>): Promise<T> { return context.run(models, action); }
export function frozenModel(kind: ModelKind, preferredId?: string | null): ModelConfig | null | undefined {
  const snapshot = context.getStore();
  if (!snapshot) return undefined;
  const model = snapshot[kind];
  return preferredId && model?.id !== preferredId ? null : model;
}
