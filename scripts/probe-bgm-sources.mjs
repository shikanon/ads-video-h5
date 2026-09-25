const sample = 'https://cdn.pixabay.com/download/audio/2024/02/08/audio_b816f864f0.mp3?filename=angel4leon-baby-smile-190123.mp3';
async function probe(label, url, options = {}) {
  try {
    const response = await fetch(url, { ...options, signal: AbortSignal.timeout(25_000) });
    const type = response.headers.get('content-type') || '';
    let bytes = 0;
    for await (const chunk of response.body || []) bytes += chunk.byteLength;
    console.log(JSON.stringify({ source: label, status: response.status, type, bytes, usable: response.ok && (label !== 'pixabay-download' || type.startsWith('audio/')) }));
  } catch (error) {
    console.log(JSON.stringify({ source: label, error: error instanceof Error ? error.message : String(error), usable: false }));
  }
}
await probe('pixabay-search', 'https://pixabay.com/zh/music/search/%E8%BD%BB%E5%BF%AB/');
await probe('24bit-search-one', 'https://www.24bit.net/api/player/searchOnlineMusicOne', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ keyword: encodeURIComponent('轻快'), page: 1 }) });
await probe('24bit-search-two', 'https://www.24bit.net/api/player/searchOnlineMusicTwo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ keyword: encodeURIComponent('轻快'), page: 1 }) });
await probe('pixabay-download', sample);
