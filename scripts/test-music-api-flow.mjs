const apiRoot = (process.env.QINGJIAN_API_BASE || 'http://127.0.0.1:8787/api').replace(/\/+$/, '');
const capturedPixabayDetail = process.env.PIXABAY_TRACK_DETAIL_URL || 'https://pixabay.com/zh/music/happy-childrens-tunes-baby-smile-190123/';
const capturedPixabayAudio = process.env.PIXABAY_AUDIO_URL || 'https://cdn.pixabay.com/download/audio/2024/02/08/audio_b816f864f0.mp3?filename=angel4leon-baby-smile-190123.mp3';

async function post(path, body) {
  const response = await fetch(`${apiRoot}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  const contentType = response.headers.get('content-type') || '';
  if (/application\/json/i.test(contentType)) {
    let data;
    try { data = await response.json(); } catch { data = null; }
    return { response, contentType, data };
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  return { response, contentType, bytes };
}

function report(name, result, extra = '') {
  const status = `${result.response.status} ${result.response.statusText}`;
  const code = result.data?.code ? ` code=${result.data.code}` : '';
  const error = result.data?.error ? ` error=${result.data.error}` : '';
  console.log(`${name}: ${status}${code}${error}${extra}`);
}

async function checkPixabay() {
  console.log('--- Pixabay ---');
  const search = await post('/music/search', { source: 'pixabay', query: '轻快' });
  report('search', search);
  let detailUrl;
  const usedSearchResult = search.response.ok && Array.isArray(search.data?.tracks) && search.data.tracks.length > 0;
  if (usedSearchResult) {
    detailUrl = search.data.tracks[0].detailUrl;
    console.log(`search result: ${search.data.tracks.length} tracks; first track has detail URL`);
  } else {
    detailUrl = capturedPixabayDetail;
    console.log(`search-to-detail: ${search.response.ok ? 'no result returned' : 'blocked'}; checking captured detail/download stages independently`);
  }

  const detail = await post('/music/pixabay/detail', { detailUrl });
  report('detail', detail);
  const audioUrl = detail.response.ok ? detail.data?.downloadUrl : capturedPixabayAudio;
  if (!audioUrl) {
    console.log('download: skipped; no audio URL was returned');
    return { fullFlow: false };
  }
  const download = await post('/music/pixabay/download', { url: audioUrl });
  const audioOk = download.response.ok && /^audio\/(?:mpeg|mp3)/i.test(download.contentType) && download.bytes?.byteLength > 1024;
  report('download', download, download.bytes ? ` contentType=${download.contentType} bytes=${download.bytes.byteLength}` : '');
  console.log(`download payload validation: ${audioOk ? 'PASS' : 'FAIL'}`);
  return { fullFlow: usedSearchResult && detail.response.ok && audioOk };
}

async function check24bit() {
  console.log('--- 24bit ---');
  const search = await post('/music/search', { source: '24bit', query: '轻快', page: 1 });
  report('search', search);
  if (!search.response.ok) {
    console.log('search-to-download: BLOCKED at search; no guessed track schema or audio URL was used');
    return { fullFlow: false };
  }
  const responseShape = ['searchOne', 'searchTwo', 'keyword'].filter((key) => key in (search.data || {})).join(',');
  console.log(`search response groups: ${responseShape || 'unexpected schema'}`);
  console.log('download: not attempted because the captured search response schema has not been verified');
  return { fullFlow: false };
}

const pixabay = await checkPixabay();
const twentyFourBit = await check24bit();
console.log(`SUMMARY Pixabay=${pixabay.fullFlow ? 'FULL_FLOW_PASS' : 'FULL_FLOW_INCOMPLETE'} 24bit=${twentyFourBit.fullFlow ? 'FULL_FLOW_PASS' : 'FULL_FLOW_INCOMPLETE'}`);
