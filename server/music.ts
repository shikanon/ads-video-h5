import type { MusicSearch } from '../src/types';

const maxAudioBytes = 25 * 1024 * 1024;

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
    const response = await fetch(current, { redirect: 'manual', signal: AbortSignal.timeout(30_000), headers: { Accept: 'audio/mpeg' } });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new Error('Pixabay 下载地址没有可用的跳转目标。');
      current = new URL(location, current);
      continue;
    }
    if (!response.ok || !response.body) throw new Error(`Pixabay 音频下载失败（HTTP ${response.status}）。`);
    const mime = response.headers.get('content-type') || '';
    if (!/audio\/(?:mpeg|mp3)|application\/octet-stream/i.test(mime)) throw new Error('Pixabay 返回的内容不是 MP3 音频。');
    const declared = Number(response.headers.get('content-length'));
    if (declared > maxAudioBytes) throw new Error('音频超过 25 MB 限制。');
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = response.body.getReader();
    while (true) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      size += chunk.byteLength;
      if (size > maxAudioBytes) { await reader.cancel().catch(() => undefined); throw new Error('音频超过 25 MB 限制。'); }
      chunks.push(chunk);
    }
    if (size < 1024) throw new Error('Pixabay 音频文件过小或不完整。');
    const rawName = current.searchParams.get('filename') || current.pathname.split('/').at(-1) || 'pixabay-bgm.mp3';
    const name = rawName.replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 100).replace(/\.mp3$/i, '') + '.mp3';
    return { bytes: Buffer.concat(chunks), name };
  }
  throw new Error('Pixabay 下载跳转次数过多。');
}
