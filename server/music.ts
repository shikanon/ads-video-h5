import { Buffer } from 'node:buffer';
import type { MusicSearch } from '../src/types';

const maxPixabayBytes = 25 * 1024 * 1024;
const max24bitBytes = 200 * 1024 * 1024;
const browserHeaders = {
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
  'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
};

export class MusicSourceError extends Error {
  constructor(message: string, readonly code: string, readonly source: 'pixabay' | '24bit', readonly upstreamStatus?: number) {
    super(message);
    this.name = 'MusicSourceError';
  }
}

export interface PixabayTrack {
  id: string;
  title: string;
  creator?: string;
  detailUrl: string;
  thumbnailUrl?: string;
}

export function musicSearchLinks(query: string): MusicSearch {
  const cleaned = query.trim().replace(/[\r\n]/g, ' ').slice(0, 60);
  if (!cleaned) throw new Error('BGM 搜索词为空。');
  return {
    query: cleaned,
    sources: [
      { name: 'Pixabay', url: `https://pixabay.com/zh/music/search/${encodeURIComponent(cleaned)}/`, note: '在原站试听、查看许可并下载 MP3' },
      { name: '24bit', url: 'https://www.24bit.net/', note: '进入原站搜索；使用前自行确认曲目授权' },
    ],
  };
}

function cleanQuery(query: unknown, source: 'pixabay' | '24bit'): string {
  const value = typeof query === 'string' ? query.trim().replace(/[\r\n]/g, ' ').slice(0, 60) : '';
  if (!value) throw new MusicSourceError('搜索词不能为空。', 'INVALID_QUERY', source);
  return value;
}

function detectChallenge(response: Response, body: string, source: 'pixabay' | '24bit'): void {
  const challenged = response.headers.get('cf-mitigated') === 'challenge' || /<title>Just a moment\.\.\.<\/title>|challenge-platform|cf-chl-/i.test(body.slice(0, 20_000));
  if (challenged) throw new MusicSourceError(`${source} 上游返回 Cloudflare 验证页；当前服务端请求未获准通过。`, 'UPSTREAM_CHALLENGE', source, response.status);
}

function decodeHtml(value: string): string {
  return value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_match, number: string) => String.fromCodePoint(Number(number))).replace(/&#x([\da-f]+);/gi, (_match, number: string) => String.fromCodePoint(parseInt(number, 16)));
}

function htmlText(value: string): string {
  return decodeHtml(value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
}

function parsePixabaySearch(html: string): PixabayTrack[] {
  const tracks: PixabayTrack[] = [];
  const seen = new Set<string>();
  const linkPattern = /<a\b[^>]*href="(\/zh\/music\/([^"/?#]+-\d+)\/)"[^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(linkPattern)) {
    const detailUrl = match[1];
    const id = match[2].match(/-(\d+)$/)?.[1];
    const title = htmlText(match[3]);
    if (!id || !title || seen.has(id)) continue;
    seen.add(id);
    const cardStart = html.lastIndexOf('<div class="audioRow--', match.index!);
    const cardEnd = html.indexOf('<div class="audioRow--', match.index! + match[0].length);
    const start = cardStart >= 0 ? cardStart : Math.max(0, match.index! - 5_000);
    const end = cardEnd >= 0 ? cardEnd : Math.min(html.length, match.index! + match[0].length + 5_000);
    const card = html.slice(start, end);
    const creatorMatch = card.match(/href="\/zh\/users\/[^"?#]+"[^>]*>([\s\S]*?)<\/a>/i);
    const imageMatch = card.match(/<img\b[^>]*src="(https:\/\/cdn\.pixabay\.com\/[^"?]+\.(?:jpg|webp)(?:\?[^\"]*)?)"/i);
    tracks.push({
      id,
      title,
      ...(creatorMatch ? { creator: htmlText(creatorMatch[1]) } : {}),
      detailUrl: `https://pixabay.com${detailUrl}`,
      ...(imageMatch ? { thumbnailUrl: decodeHtml(imageMatch[1]) } : {}),
    });
  }
  return tracks;
}

async function fetchPixabay(url: URL, accept: string): Promise<{ response: Response; body: string }> {
  const response = await fetch(url, {
    redirect: 'manual',
    signal: AbortSignal.timeout(30_000),
    headers: {
      ...browserHeaders,
      accept,
      referer: 'https://pixabay.com/zh/music/',
      'sec-fetch-dest': 'document',
      'sec-fetch-mode': 'navigate',
      'sec-fetch-site': 'same-origin',
      'upgrade-insecure-requests': '1',
    },
  });
  const body = await response.text();
  detectChallenge(response, body, 'pixabay');
  if (!response.ok) throw new MusicSourceError(`Pixabay 请求失败（HTTP ${response.status}）。`, 'UPSTREAM_HTTP_ERROR', 'pixabay', response.status);
  return { response, body };
}

export async function searchPixabayMusic(queryInput: unknown): Promise<{ source: 'pixabay'; query: string; page: 1; tracks: PixabayTrack[]; total?: number }> {
  const query = cleanQuery(queryInput, 'pixabay');
  const url = new URL(`https://pixabay.com/zh/music/search/${encodeURIComponent(query)}/`);
  const { body } = await fetchPixabay(url, 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8');
  const heading = body.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || '';
  const total = heading.match(/([\d,]+)\s*(?:免版税|royalty-free)/i)?.[1];
  return { source: 'pixabay', query, page: 1, tracks: parsePixabaySearch(body), ...(total ? { total: Number(total.replace(/,/g, '')) } : {}) };
}

export async function getPixabayTrackDetail(detailUrlInput: unknown): Promise<{ source: 'pixabay'; detailUrl: string; title?: string; creator?: string; downloadUrl: string }> {
  let detailUrl: URL;
  try { detailUrl = new URL(typeof detailUrlInput === 'string' ? detailUrlInput : ''); } catch { throw new MusicSourceError('Pixabay 曲目详情地址无效。', 'INVALID_TRACK_URL', 'pixabay'); }
  if (detailUrl.protocol !== 'https:' || detailUrl.hostname !== 'pixabay.com' || !/^\/zh\/music\/[\w-]+-\d+\/$/.test(detailUrl.pathname)) throw new MusicSourceError('只支持 Pixabay 官方音乐曲目详情页。', 'INVALID_TRACK_URL', 'pixabay');
  const { body } = await fetchPixabay(detailUrl, 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8');
  const download = body.match(/https:\/\/cdn\.pixabay\.com\/download\/audio\/[\w/-]+\.mp3(?:\?[^"'<>\s\\]+)?/i)?.[0];
  if (!download) throw new MusicSourceError('Pixabay 详情页中没有找到 MP3 下载地址，页面结构可能已变化。', 'UPSTREAM_SCHEMA_CHANGED', 'pixabay');
  const title = htmlText(body.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || '') || undefined;
  const creator = body.match(/"creator"\s*:\s*\{[^}]*"name"\s*:\s*"([^"]+)"/i)?.[1];
  return { source: 'pixabay', detailUrl: detailUrl.toString(), ...(title ? { title } : {}), ...(creator ? { creator: decodeHtml(creator) } : {}), downloadUrl: decodeHtml(download) };
}

function validate24bitPage(pageInput: unknown): number {
  const page = Number(pageInput ?? 1);
  if (!Number.isInteger(page) || page < 1 || page > 100) throw new MusicSourceError('24bit 页码必须是 1 到 100 的整数。', 'INVALID_PAGE', '24bit');
  return page;
}

async function post24bit(path: string, payload: Record<string, unknown>, referer = 'https://www.24bit.net/'): Promise<{ status: number; contentType: string; body: string }> {
  const response = await fetch(`https://www.24bit.net/api${path}`, {
    method: 'POST',
    redirect: 'manual',
    signal: AbortSignal.timeout(30_000),
    headers: {
      ...browserHeaders,
      accept: 'application/json, text/plain, */*',
      'content-type': 'application/json',
      origin: 'https://www.24bit.net',
      referer,
      token: '',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-origin',
    },
    body: JSON.stringify(payload),
  });
  const body = await response.text();
  detectChallenge(response, body, '24bit');
  if (!response.ok) throw new MusicSourceError(`24bit 请求失败（HTTP ${response.status}）。`, 'UPSTREAM_HTTP_ERROR', '24bit', response.status);
  return { status: response.status, contentType: response.headers.get('content-type') || '', body };
}

export async function search24bitMusic(queryInput: unknown, pageInput: unknown = 1): Promise<{ source: '24bit'; query: string; page: number; searchOne: unknown; searchTwo: unknown; keyword: unknown }> {
  const query = cleanQuery(queryInput, '24bit');
  const page = validate24bitPage(pageInput);
  const encodedKeyword = encodeURIComponent(query);
  const [one, two, keyword] = await Promise.all([
    post24bit('/player/searchOnlineMusicOne', { keyword: encodedKeyword, page }),
    post24bit('/player/searchOnlineMusicTwo', { keyword: encodedKeyword, page }),
    post24bit('/player/setKeyword', { keyword: encodedKeyword }),
  ]);
  const parse = (value: string) => { try { return JSON.parse(value) as unknown; } catch { throw new MusicSourceError('24bit 返回的搜索内容不是 JSON，接口格式可能已变化。', 'UPSTREAM_SCHEMA_CHANGED', '24bit'); } };
  return { source: '24bit', query, page, searchOne: parse(one.body), searchTwo: parse(two.body), keyword: parse(keyword.body) };
}

export interface TwentyFourBitTrack {
  type: string;
  name: string;
  player: string;
  album: string;
}

function validate24bitTrack(input: unknown): TwentyFourBitTrack {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new MusicSourceError('24bit 曲目信息无效。', 'INVALID_TRACK', '24bit');
  const track = input as Record<string, unknown>;
  const clean = (key: keyof TwentyFourBitTrack, max: number) => typeof track[key] === 'string' ? (track[key] as string).trim().slice(0, max) : '';
  const value = { type: clean('type', 8), name: clean('name', 200), player: clean('player', 200), album: clean('album', 200) };
  if (!value.type || !value.name || !value.player || !value.album || !/^[a-z\d_-]+$/i.test(value.type)) throw new MusicSourceError('24bit 曲目必须包含 type、name、player、album。', 'INVALID_TRACK', '24bit');
  return value;
}

function validNetEaseAudioUrl(input: unknown): URL {
  let url: URL;
  try { url = new URL(typeof input === 'string' ? input : ''); } catch { throw new MusicSourceError('24bit 返回的音频地址无效。', 'INVALID_TRACK_URL', '24bit'); }
  if (url.protocol !== 'https:' || !/^m\d+\.music\.126\.net$/i.test(url.hostname) || !/\.(?:mp3|flac|m4a|aac|wav)$/i.test(url.pathname)) throw new MusicSourceError('只支持 24bit 曲目页提供的 NetEase 音频地址。', 'INVALID_TRACK_URL', '24bit');
  return url;
}

async function readAudioResponse(response: Response, maxBytes: number, source: 'pixabay' | '24bit'): Promise<Buffer> {
  const mime = response.headers.get('content-type') || '';
  if (!response.ok || !response.body) throw new MusicSourceError(`${source} 音频下载失败（HTTP ${response.status}）。`, 'UPSTREAM_HTTP_ERROR', source, response.status);
  if (!/audio\//i.test(mime) && !/application\/octet-stream/i.test(mime)) throw new MusicSourceError(`${source} 返回内容不是音频文件。`, 'UPSTREAM_CONTENT_TYPE', source, response.status);
  const declared = Number(response.headers.get('content-length'));
  if (declared > maxBytes) throw new MusicSourceError(`${source} 音频超过 ${Math.floor(maxBytes / 1024 / 1024)} MB 限制。`, 'FILE_TOO_LARGE', source);
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = response.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) { await reader.cancel().catch(() => undefined); throw new MusicSourceError(`${source} 音频超过 ${Math.floor(maxBytes / 1024 / 1024)} MB 限制。`, 'FILE_TOO_LARGE', source); }
    chunks.push(value);
  }
  if (size < 1024) throw new MusicSourceError(`${source} 音频文件过小或不完整。`, 'UPSTREAM_CONTENT_TYPE', source);
  return Buffer.concat(chunks);
}

export function pixabayAudioUrl(message: string): URL | null {
  const match = message.match(/https:\/\/cdn\.pixabay\.com\/download\/audio\/[^\s<>"']+/i);
  if (!match) return null;
  try {
    const url = new URL(match[0].replace(/[，。；）)]+$/, ''));
    if (url.protocol !== 'https:' || url.hostname !== 'cdn.pixabay.com' || !/^\/download\/audio\/[\w/-]+\.mp3$/.test(url.pathname)) return null;
    return url;
  } catch { return null; }
}

export async function downloadPixabayAudio(url: URL): Promise<{ bytes: Buffer; name: string }> {
  let current = url;
  for (let redirect = 0; redirect < 3; redirect++) {
    if (current.protocol !== 'https:' || current.hostname !== 'cdn.pixabay.com' || !/^\/download\/audio\/[\w/-]+\.mp3$/.test(current.pathname)) throw new Error('只支持 Pixabay 官方 CDN 的 MP3 下载地址。');
    const response = await fetch(current, { redirect: 'manual', signal: AbortSignal.timeout(30_000), headers: { ...browserHeaders, accept: 'audio/mpeg', referer: 'https://pixabay.com/zh/music/' } });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new Error('Pixabay 下载地址没有可用的跳转目标。');
      current = new URL(location, current);
      continue;
    }
    const contentType = response.headers.get('content-type') || '';
    if (!/audio\/(?:mpeg|mp3)|application\/octet-stream/i.test(contentType)) throw new Error(`Pixabay 返回的内容不是 MP3 音频（${contentType || '未知类型'}）。`);
    const bytes = await readAudioResponse(response, maxPixabayBytes, 'pixabay');
    const rawName = current.searchParams.get('filename') || current.pathname.split('/').at(-1) || 'pixabay-bgm.mp3';
    const name = rawName.replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 100).replace(/\.mp3$/i, '') + '.mp3';
    return { bytes, name };
  }
  throw new Error('Pixabay 下载跳转次数过多。');
}

export async function download24bitAudio(trackInput: unknown, audioUrlInput: unknown, detailUrlInput: unknown): Promise<{ bytes: Buffer; name: string; mimeType: string }> {
  const track = validate24bitTrack(trackInput);
  const audioUrl = validNetEaseAudioUrl(audioUrlInput);
  let detailUrl: URL;
  try { detailUrl = new URL(typeof detailUrlInput === 'string' ? detailUrlInput : ''); } catch { throw new MusicSourceError('请提供 24bit 曲目详情页地址。', 'INVALID_TRACK_URL', '24bit'); }
  if (detailUrl.protocol !== 'https:' || detailUrl.hostname !== 'www.24bit.net' || !/^\/music\/c\/[a-f\d]+$/i.test(detailUrl.pathname)) throw new MusicSourceError('只支持 24bit 官方曲目详情页。', 'INVALID_TRACK_URL', '24bit');
  const referer = detailUrl.toString();
  const grant = await post24bit('/music/getOnlineDownload', { ...track }, referer);
  let grantResult: unknown;
  try { grantResult = JSON.parse(grant.body); } catch { throw new MusicSourceError('24bit 下载授权接口返回格式异常。', 'UPSTREAM_SCHEMA_CHANGED', '24bit'); }
  if (!grantResult || typeof grantResult !== 'object' || (grantResult as Record<string, unknown>).status !== true) throw new MusicSourceError('24bit 未授权下载此曲目。', 'DOWNLOAD_NOT_AUTHORIZED', '24bit');

  const response = await fetch(audioUrl, { redirect: 'manual', signal: AbortSignal.timeout(90_000), headers: { ...browserHeaders, accept: 'audio/*,application/octet-stream;q=0.9,*/*;q=0.8', referer } });
  const contentType = response.headers.get('content-type') || '';
  if (/text\/html/i.test(contentType)) {
    const body = await response.text();
    detectChallenge(response, body, '24bit');
    throw new MusicSourceError(`NetEase 音频请求失败（HTTP ${response.status}）。`, 'UPSTREAM_HTTP_ERROR', '24bit', response.status);
  }
  if (response.headers.get('cf-mitigated') === 'challenge') throw new MusicSourceError('NetEase 音频上游要求 Cloudflare 验证。', 'UPSTREAM_CHALLENGE', '24bit', response.status);
  const bytes = await readAudioResponse(response, max24bitBytes, '24bit');
  const extension = audioUrl.pathname.split('.').at(-1)?.toLowerCase() || 'audio';
  const safeName = track.name.replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 120) || '24bit-track';
  const mimeType = response.headers.get('content-type')?.split(';')[0] || 'application/octet-stream';
  return { bytes, name: `${safeName}.${extension}`, mimeType };
}
