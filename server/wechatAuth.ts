export interface WeChatIdentity { appId: string; openId: string; }
export class WeChatLoginError extends Error {
  constructor(message: string, readonly code: string, readonly status: number) { super(message); }
}

// Only this server-side exchange may establish a WeChat identity. Never accept
// an OpenID, session_key, profile or email supplied by the client as identity.
export function createWeChatExchange(options: { fetch?: typeof fetch; config?: () => { appId?: string; appSecret?: string } } = {}) {
  const request = options.fetch ?? fetch;
  const config = options.config ?? (() => ({ appId: process.env.QINGJIAN_WECHAT_APP_ID, appSecret: process.env.QINGJIAN_WECHAT_APP_SECRET }));
  return async (code: string): Promise<WeChatIdentity> => {
    const { appId, appSecret } = config();
    if (!appId || !/^wx[a-f0-9]{16}$/.test(appId) || !appSecret) throw new WeChatLoginError('微信登录暂未配置，请联系管理员。', 'WECHAT_LOGIN_UNCONFIGURED', 503);
    const url = new URL('https://api.weixin.qq.com/sns/jscode2session');
    url.search = new URLSearchParams({ appid: appId, secret: appSecret, js_code: code, grant_type: 'authorization_code' }).toString();
    let result: { errcode?: number; openid?: string };
    try {
      const response = await request(url, { signal: AbortSignal.timeout(8000), redirect: 'error' });
      if (!response.ok) throw new Error('WeChat unavailable');
      result = await response.json() as typeof result;
      if (!result || typeof result !== 'object') throw new Error('Invalid WeChat response');
    } catch {
      // Provider errors can contain the secret/code URL. Do not log or expose it.
      throw new WeChatLoginError('微信登录服务暂时不可用，请重试。', 'WECHAT_LOGIN_UNAVAILABLE', 502);
    }
    if ([40029, 40163, 40226].includes(Number(result.errcode))) throw new WeChatLoginError('微信登录凭证已失效，请重新点击微信登录。', 'WECHAT_CODE_INVALID', 400);
    if (result.errcode === 45011) throw new WeChatLoginError('微信登录过于频繁，请稍后再试。', 'WECHAT_LOGIN_LIMITED', 429);
    if (result.errcode || typeof result.openid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(result.openid)) throw new WeChatLoginError('微信登录验证失败，请稍后重试或联系管理员。', 'WECHAT_LOGIN_FAILED', 502);
    return { appId, openId: result.openid };
  };
}
