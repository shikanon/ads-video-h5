/*
 * Browser-context client for the two authorized website test flows.
 * Run this script on the corresponding site's own origin. Same-origin fetch
 * sends the browser's session automatically; this code never reads or logs
 * document.cookie. It does not solve or bypass Cloudflare challenges.
 */
(() => {
  const browserHeaders = { accept: 'application/json, text/plain, */*', token: '' };

  function assertHost(source) {
    const host = location.hostname.toLowerCase();
    const allowed = source === 'pixabay' ? host === 'pixabay.com' : host === 'www.24bit.net';
    if (!allowed) throw new Error(`请在 ${source === 'pixabay' ? 'pixabay.com' : 'www.24bit.net'} 原站页面中运行此方法。`);
  }

  function challengeError(source, response, body = '') {
    const challenge = response.headers.get('cf-mitigated') === 'challenge' || /challenge-platform|cf-chl-|<title>Just a moment\.\.\.<\/title>/i.test(body.slice(0, 20_000));
    if (!challenge) return null;
    const error = new Error(`${source} 返回 Cloudflare challenge（HTTP ${response.status}）。`);
    error.code = 'UPSTREAM_CHALLENGE';
    error.status = response.status;
    error.rayId = response.headers.get('cf-ray') || undefined;
    return error;
  }

  async function getPixabaySearch(query) {
    assertHost('pixabay');
    const cleaned = String(query || '').trim().replace(/[\r\n]/g, ' ').slice(0, 60);
    if (!cleaned) throw new Error('搜索词不能为空。');
    const response = await fetch(`/zh/music/search/${encodeURIComponent(cleaned)}/`, { credentials: 'include', headers: { accept: 'text/html,application/xhtml+xml' } });
    const html = await response.text();
    const blocked = challengeError('Pixabay', response, html);
    if (blocked) throw blocked;
    if (!response.ok) throw new Error(`Pixabay 搜索失败（HTTP ${response.status}）。`);
    const document = new DOMParser().parseFromString(html, 'text/html');
    const seen = new Set();
    const tracks = [];
    for (const anchor of document.querySelectorAll('a[href^="/zh/music/"]')) {
      const match = anchor.getAttribute('href')?.match(/^\/zh\/music\/([^/?#]+-(\d+))\/$/);
      if (!match || seen.has(match[2])) continue;
      const card = anchor.closest('[class*="audioRow"]') || anchor.parentElement;
      seen.add(match[2]);
      const creator = card?.querySelector('a[href^="/zh/users/"]')?.textContent?.trim();
      const thumbnail = card?.querySelector('img')?.getAttribute('src') || undefined;
      tracks.push({ id: match[2], title: anchor.textContent.trim(), creator, detailUrl: new URL(anchor.getAttribute('href'), location.origin).href, thumbnailUrl: thumbnail });
    }
    return { source: 'pixabay', query: cleaned, tracks, pageTitle: document.querySelector('h1')?.textContent?.trim() || '' };
  }

  async function getPixabayTrack(detailUrl) {
    assertHost('pixabay');
    const url = new URL(detailUrl, location.origin);
    if (url.origin !== location.origin || !/^\/zh\/music\/[\w-]+-\d+\/$/.test(url.pathname)) throw new Error('只支持 Pixabay 官方音乐详情页。');
    const response = await fetch(url.href, { credentials: 'include' });
    const html = await response.text();
    const blocked = challengeError('Pixabay', response, html);
    if (blocked) throw blocked;
    if (!response.ok) throw new Error(`Pixabay 详情请求失败（HTTP ${response.status}）。`);
    const match = html.match(/https:\/\/cdn\.pixabay\.com\/download\/audio\/[\w/-]+\.mp3(?:\?[^"'<>\s\\]+)?/i);
    if (!match) throw new Error('Pixabay 页面中没有找到 MP3 地址，页面结构可能已变化。');
    const title = new DOMParser().parseFromString(html, 'text/html').querySelector('h1')?.textContent?.trim() || '';
    return { source: 'pixabay', detailUrl: url.href, title, downloadUrl: match[0].replace(/&amp;/g, '&') };
  }

  async function getPixabayDownload(trackOrUrl) {
    assertHost('pixabay');
    const sourceUrl = typeof trackOrUrl === 'string' ? trackOrUrl : trackOrUrl?.downloadUrl;
    const url = new URL(sourceUrl, location.origin);
    if (url.hostname !== 'cdn.pixabay.com' || !/^\/download\/audio\/[\w/-]+\.mp3$/.test(url.pathname)) throw new Error('只支持 Pixabay 官方 MP3 下载地址。');
    const response = await fetch(url.href, { credentials: 'omit' });
    const blocked = challengeError('Pixabay', response);
    if (blocked) throw blocked;
    if (!response.ok || !response.body) throw new Error(`Pixabay 下载失败（HTTP ${response.status}）。`);
    const contentType = response.headers.get('content-type') || '';
    if (!/audio\/(?:mpeg|mp3)|application\/octet-stream/i.test(contentType)) throw new Error(`Pixabay 返回的不是 MP3（${contentType || '未知类型'}）。`);
    const fileName = url.searchParams.get('filename') || url.pathname.split('/').pop() || 'pixabay-bgm.mp3';
    return { source: 'pixabay', fileName, contentType, contentLength: Number(response.headers.get('content-length')) || null, body: response.body };
  }

  async function post24bit(path, payload) {
    assertHost('24bit');
    const response = await fetch(`/api${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: { ...browserHeaders, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const text = await response.text();
    const blocked = challengeError('24bit', response, text);
    if (blocked) throw blocked;
    if (!response.ok) throw new Error(`24bit 请求失败（HTTP ${response.status}）。`);
    let data;
    try { data = JSON.parse(text); } catch { throw new Error('24bit 响应不是 JSON。'); }
    if (data?.status !== true) throw new Error(`24bit 接口未成功：${String(data?.result ?? 'unknown')}`);
    return data;
  }

  async function search24bit(query, page = 1) {
    assertHost('24bit');
    const cleaned = String(query || '').trim().replace(/[\r\n]/g, ' ').slice(0, 60);
    if (!cleaned) throw new Error('搜索词不能为空。');
    if (!Number.isInteger(page) || page < 1 || page > 100) throw new Error('页码必须是 1 到 100 的整数。');
    const keyword = encodeURIComponent(cleaned);
    const [one, two, saved] = await Promise.all([
      post24bit('/player/searchOnlineMusicOne', { keyword, page }),
      post24bit('/player/searchOnlineMusicTwo', { keyword, page }),
      post24bit('/player/setKeyword', { keyword }),
    ]);
    return { source: '24bit', query: cleaned, page, one: one.result, two: two.result, keywordSaved: saved.status === true };
  }

  async function get24bitDownload(track, type = 'c') {
    assertHost('24bit');
    if (!track || !track.id || !track.name || !track.player || !track.album) throw new Error('曲目必须包含 id、name、player、album。');
    if (!/^[a-z\d_-]+$/i.test(type)) throw new Error('曲目类型无效。');
    const detailUrl = new URL(`/music/${type}/${encodeURIComponent(track.id)}`, location.origin);
    const detail = await fetch(detailUrl.href, { credentials: 'include' });
    const html = await detail.text();
    const blocked = challengeError('24bit', detail, html);
    if (blocked) throw blocked;
    if (!detail.ok) throw new Error(`24bit 曲目详情失败（HTTP ${detail.status}）。`);
    const match = html.match(/https?:\/\/m\d+\.music\.126\.net\/[^"'<>\s\\]+/i);
    if (!match) throw new Error('24bit 详情页没有音频地址。');
    const audioUrl = match[0].replace(/\\\//g, '/').replace(/&amp;/g, '&');
    const grant = await post24bit('/music/getOnlineDownload', { type, name: track.name, player: track.player, album: track.album });
    if (grant.status !== true) throw new Error('24bit 未授权下载该曲目。');
    const audio = await fetch(audioUrl, { credentials: 'omit' });
    if (!audio.ok || !audio.body) throw new Error(`24bit 音频下载失败（HTTP ${audio.status}）。`);
    const extension = new URL(audioUrl).pathname.split('.').pop()?.toLowerCase() || 'audio';
    return {
      source: '24bit',
      fileName: `${String(track.name).replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 120) || '24bit-track'}.${extension}`,
      contentType: audio.headers.get('content-type') || 'application/octet-stream',
      contentLength: Number(audio.headers.get('content-length')) || null,
      body: audio.body,
    };
  }

  async function saveDownload(download, fileHandle) {
    if (!download?.body || !download.fileName) throw new Error('下载流无效。');
    if (fileHandle) {
      const writable = await fileHandle.createWritable();
      await download.body.pipeTo(writable);
      return { fileName: download.fileName, bytes: download.contentLength };
    }
    const response = new Response(download.body, { headers: { 'content-type': download.contentType } });
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = download.fileName;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    return { fileName: download.fileName, bytes: blob.size };
  }

  async function download24bitTrack(track, type = 'c') {
    assertHost('24bit');
    let fileHandle;
    if (typeof window.showSaveFilePicker === 'function') {
      const safeName = String(track?.name || '24bit-track').replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 120);
      try { fileHandle = await window.showSaveFilePicker({ suggestedName: `${safeName || '24bit-track'}.flac` }); }
      catch (error) { if (error?.name === 'AbortError') throw error; }
    }
    const download = await get24bitDownload(track, type);
    return saveDownload(download, fileHandle);
  }

  window.qingjianMusicBrowser = Object.freeze({ searchPixabay: getPixabaySearch, getPixabayTrack, getPixabayDownload, search24bit, get24bitDownload, download24bitTrack, saveDownload });
})();
