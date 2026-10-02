import { lookup } from 'node:dns';
import { isIP } from 'node:net';
import { request } from 'node:https';

export function publicAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b, c] = ip.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0 || b === 2) || a === 100 && b >= 64 && b <= 127 || a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) || a === 203 && b === 0 && c === 113);
  }
  // Global unicast only; exclude documentation, transition and protocol ranges.
  return isIP(ip) === 6 && /^[23][\da-f]{3}:/i.test(ip) && !/^2001:db8:|^2002:/i.test(ip) && !(/^2001:/i.test(ip) && parseInt(ip.split(':')[1] || '0',16)<0x200);
}

export function publicResearchUrl(value: string): string | undefined {
  try {
    const u = new URL(value), host = u.hostname.replace(/^\[|\]$/g, '');
    if (u.protocol !== 'https:' || u.username || u.password || u.port || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(host) || !host.includes('.') && !isIP(host) || isIP(host) && !publicAddress(host)) return;
    u.hash = ''; return u.href;
  } catch { return; }
}

export interface PublicPage { url: string; text: string; contentType: string; }
export type PublicReader = (url: string) => Promise<PublicPage>;

// Validate and pin every resolved connection, including redirects. No proxy,
// cookies, TLS exceptions or access to private addresses for external sources.
export async function readPublicPage(value: string, redirects = 0): Promise<PublicPage> {
  const safe = publicResearchUrl(value);
  if (!safe || redirects > 3) throw new Error('研究资料 URL 必须是公开 HTTPS 页面。');
  return new Promise((resolve, reject) => {
    const req = request(safe, {
      headers: { Accept: 'text/html,application/json,text/plain', 'User-Agent': 'Qingjian-Research/1.0' },
      lookup: (host, options, cb) => lookup(host, { all: true }, (error, addresses) => {
        if (error) return cb(error, '', 4);
        if (!addresses.length || addresses.some(a => !publicAddress(a.address))) return cb(new Error('研究页面解析到非公开地址。'), '', 4);
        const selected = addresses.find(a => a.family === 4) || addresses[0];
        if (options.all) (cb as Function)(null, [selected]);
        else cb(null, selected.address, selected.family);
      }),
    }, res => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume(); readPublicPage(new URL(res.headers.location, safe).href, redirects + 1).then(resolve, reject); return;
      }
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`研究页面 HTTP ${res.statusCode}`)); return; }
      const contentType = String(res.headers['content-type'] || '');
      if (!/text\/html|application\/(?:json|ld\+json)|text\/plain/.test(contentType)) { res.resume(); reject(new Error('研究页面不是可读取的网页或 JSON。')); return; }
      const chunks: Buffer[] = []; let size = 0;
      res.on('data', (chunk: Buffer) => { size += chunk.length; if (size > 1500000) req.destroy(new Error('研究页面超过 1.5 MB 上限。')); else chunks.push(chunk); });
      res.on('error', reject);
      res.on('end', () => resolve({ url: safe, text: Buffer.concat(chunks).toString('utf8'), contentType }));
    });
    const timer = setTimeout(() => req.destroy(new Error('研究页面读取超时。')), 20000);
    req.on('close', () => clearTimeout(timer)); req.on('error', reject); req.end();
  });
}
