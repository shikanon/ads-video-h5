import { AsyncLocalStorage } from 'node:async_hooks';
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { creditFetch } from './creditUsage';

const execution = new AsyncLocalStorage<AbortSignal>();

export class JobCancelledError extends Error {
  constructor() { super('用户已停止运行。'); this.name = 'JobCancelledError'; }
}

export const currentJobSignal = () => execution.getStore();

export function throwIfJobCancelled(signal = currentJobSignal()) {
  if (signal?.aborted) throw new JobCancelledError();
}

export function onJobAbort(callback: () => void, signal = currentJobSignal()): () => void {
  if (!signal) return () => {};
  if (signal.aborted) { callback(); return () => {}; }
  signal.addEventListener('abort', callback, { once: true });
  return () => signal.removeEventListener('abort', callback);
}

export async function runWithJobSignal<T>(signal: AbortSignal, action: () => Promise<T>): Promise<T> {
  return execution.run(signal, async () => {
    throwIfJobCancelled();
    try {
      const result = await action();
      throwIfJobCancelled();
      return result;
    } catch (error) { throwIfJobCancelled(); throw error; }
  });
}

// Each outgoing request keeps its own timeout and also observes the user's stop.
export const jobFetch: typeof fetch = async (input, init) => {
  const signal = currentJobSignal();
  throwIfJobCancelled(signal);
  const inherited = init?.signal ?? (input instanceof Request ? input.signal : undefined);
  const combined = signal && inherited ? AbortSignal.any([signal, inherited]) : signal || inherited;
  try {
    const response = await creditFetch(input, { ...init, ...(combined ? { signal: combined } : {}) });
    if (signal?.aborted) await response.body?.cancel();
    throwIfJobCancelled(signal);
    return response;
  } catch (error) { throwIfJobCancelled(signal); throw error; }
};

export const spawnForJob: typeof spawn = ((command: string, argsOrOptions?: readonly string[] | SpawnOptions, options?: SpawnOptions): ChildProcess => {
  const signal = currentJobSignal();
  throwIfJobCancelled(signal);
  const args = Array.isArray(argsOrOptions) ? argsOrOptions : [];
  const settings = (Array.isArray(argsOrOptions) ? options : argsOrOptions) as SpawnOptions | undefined;
  // Give CLI renderers a process group so their FFmpeg workers stop with them.
  const grouped = Boolean(signal) && process.platform !== 'win32';
  const child = spawn(command, args, { ...settings, ...(grouped ? { detached: true } : {}) });
  const unbind = onJobAbort(() => {
    if (grouped && child.pid) {
      try { process.kill(-child.pid, 'SIGKILL'); return; } catch { /* It may already have exited. */ }
    }
    child.kill('SIGKILL');
  }, signal);
  child.once('close', unbind);
  child.once('error', unbind);
  return child;
}) as typeof spawn;

export function jobDelay(ms: number): Promise<void> {
  const signal = currentJobSignal();
  throwIfJobCancelled(signal);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { unbind(); resolve(); }, ms);
    const unbind = onJobAbort(() => { clearTimeout(timer); reject(new JobCancelledError()); }, signal);
  });
}
