export const apiPath = (url: string) => `${import.meta.env.VITE_API_BASE_PATH.replace(/\/$/, '')}${url}`;

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) { super(message); }
}

export async function api<T>(url: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiPath(url), {
    ...init,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init?.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
  });
  const result = await response.json() as T & { error?: string; code?: string };
  if (!response.ok) {
    if (response.status === 401 && result.code === 'ADMIN_UNAUTHORIZED') window.dispatchEvent(new CustomEvent('qingjian:admin:unauthorized', { detail: { token } }));
    throw new ApiError(result.error || '请求失败，请重试。', response.status, result.code);
  }
  return result;
}
