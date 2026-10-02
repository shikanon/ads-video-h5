import { randomUUID } from 'node:crypto';
import { spawnForJob as spawn } from './jobExecution';
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import ffmpegPath from 'ffmpeg-static';
import { detectImage, probeVideo } from './core';
import type { createOssStorage } from './ossStorage';
import { MAX_EFFECT_IMAGE_UPLOAD_BYTES, MAX_MEDIA_UPLOAD_BYTES } from '../src/uploadLimits';
import { motionLibrary } from './motionComponents';
import { richMotionIds, richMotionTemplates } from './motionTemplates';
export { motionLibrary } from './motionComponents';

export interface EffectValues { eyebrow: string; title: string; subtitle: string; imageUrl: string; videoUrl: string; assetId: string; accent: string }
export interface EffectAsset { id: string; name: string; kind: 'image' | 'video'; mimeType: string; size: number; createdAt: string }
export interface HtmlEffect {
  id: string; name: string; description: string; html: string; duration: number;
  width: number; height: number; enabled: boolean; defaults: EffectValues;
  createdAt: string; updatedAt: string;
}
export interface EffectRender { id: string; effectId: string; status: 'queued' | 'running' | 'succeeded' | 'failed'; createdAt: string; file?: string; error?: string }
export interface EffectSourceMedia { file: string; kind: 'image' | 'video'; mimeType: string }

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const gsapPath = path.join(root, 'node_modules', 'gsap', 'dist', 'gsap.min.js');
const cliPath = path.join(root, 'node_modules', '.bin', 'hyperframes');
const ffprobePath: string = createRequire(import.meta.url)('ffprobe-static').path;
const allowedAccent = /^#[0-9a-fA-F]{6}$/;
const blankValues: EffectValues = { eyebrow: '轻剪 · YOUR STORY', title: '去看更大的世界', subtitle: '把今天，剪成值得收藏的片段。', imageUrl: '', videoUrl: '', assetId: '', accent: '#fb7353' };


const baseCss = `@font-face{font-family:"PingFang SC";src:local("PingFang SC"),local("Hiragino Sans GB")}@font-face{font-family:"Microsoft YaHei";src:local("Microsoft YaHei"),local("Noto Sans CJK SC")}*{box-sizing:border-box}html,body{margin:0;width:var(--qj-width,1080px);height:var(--qj-height,1920px);overflow:hidden;background:#fffdfa;font-family:"PingFang SC","Microsoft YaHei",Arial,sans-serif;color:#252935}#root{position:relative;width:var(--qj-width,1080px);height:var(--qj-height,1920px);overflow:hidden;background:#fffdfa}.eyebrow{font-size:30px;letter-spacing:.22em;font-weight:700;color:#866d62}.title{font-size:118px;line-height:1.15;font-weight:800;letter-spacing:-.045em}.subtitle{font-size:43px;line-height:1.5;color:#625b59}.brand{font-size:42px;font-weight:800;letter-spacing:-.08em}.brand i{color:var(--qj-accent,#fb7353);font-style:normal}.line{height:7px;width:250px;border-radius:8px;background:var(--qj-accent,#fb7353)}.photo{background:linear-gradient(145deg,#c5e8ed 0%,#7bbbd0 38%,#ecb98f 63%,#e78163 100%);background-position:center;background-size:cover}.safe{position:absolute;left:90px;right:90px}`;
const head = (extra = '') => `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=1080,height=1920"><style>${baseCss}${extra}</style><!--QJ_RUNTIME--></head><body>`;
const rootOpen = (duration: number) => `<main id="root" data-composition-id="main" data-start="0" data-duration="${duration}" data-width="1080" data-height="1920">`;
const tail = (script: string) => `</main><!--QJ_DATA--><script>${script}\nwindow.__timelines["main"]=tl;tl.seek(0);if(window.__QJ_PREVIEW__)tl.play(0);</script></body></html>`;

function openingHtml(): string { return head(`.sun{position:absolute;width:980px;height:980px;left:410px;top:-260px;border-radius:50%;background:#ffe5cf}.arch{position:absolute;top:260px;left:76px;width:928px;height:960px;border-radius:460px 460px 42px 42px;overflow:hidden;background:#d4e8e5}.arch:after{content:"";position:absolute;inset:0;background:linear-gradient(0deg,rgba(28,86,99,.48),transparent 52%)}.water{position:absolute;left:-4%;top:49%;width:110%;height:60%;background:linear-gradient(#3d95ad,#186d8e)}.hill{position:absolute;left:-10%;top:30%;width:115%;height:37%;background:#eac59d;clip-path:polygon(0 100%,18% 27%,34% 58%,60% 0,100% 76%,100% 100%)}.copy{top:1220px}.copy .title{margin:42px 0 28px}.brand{position:absolute;top:75px;left:88px}.footer{position:absolute;bottom:90px;left:90px;display:flex;gap:30px;align-items:center;font-size:26px;color:#8f827b}`) + rootOpen(6) + `<div class="sun" id="sun" data-start="0" data-duration="6" data-track-index="0"></div><div class="arch" id="arch" data-start="0" data-duration="6" data-track-index="1"><div class="hill"></div><div class="water"></div></div><div class="brand" id="brand" data-start="0" data-duration="6" data-track-index="2">轻剪<i>.</i></div><div class="safe copy"><div class="eyebrow" id="eyebrow" data-qj-field="eyebrow" data-start="0" data-duration="6" data-track-index="3"></div><h1 class="title" id="title" data-qj-field="title" data-start="0" data-duration="6" data-track-index="4"></h1><div class="line" id="line" data-start="0" data-duration="6" data-track-index="5"></div><p class="subtitle" id="subtitle" data-qj-field="subtitle" data-start="0" data-duration="6" data-track-index="6"></p></div><div class="footer" id="footer" data-start="0" data-duration="6" data-track-index="7">01 / 03 <span>把瞬间留下来</span></div>` + tail(`const tl=gsap.timeline({paused:true});QJMotion.cardPop(tl,'#arch',.18);QJMotion.imageDrift(tl,'#arch',.34,5.1);QJMotion.textRise(tl,'#eyebrow',.55);QJMotion.textRise(tl,'#title',.72);QJMotion.lineDraw(tl,'#line',1.17);QJMotion.textRise(tl,'#subtitle',1.3);tl.fromTo('#brand',{opacity:0,x:-30},{opacity:1,x:0,duration:.32,ease:'expo.out'},.22);tl.fromTo('#footer',{opacity:0},{opacity:1,duration:.35,ease:'sine.out'},1.55);QJMotion.fadeOut(tl,'#footer',5.55,.25);`); }
function photoHtml(): string { return head(`.canvas{position:absolute;inset:0;background:#f3e8dc}.photo{position:absolute;left:46px;top:46px;width:988px;height:1340px;border-radius:44px;overflow:hidden}.photo:after{content:"";position:absolute;inset:0;background:linear-gradient(0deg,rgba(27,54,55,.46),transparent 55%)}.blob{position:absolute;right:-130px;bottom:150px;width:520px;height:520px;background:#fff0e9;border-radius:50%}.panel{position:absolute;left:46px;right:46px;bottom:48px;height:494px;background:#fffdfa;border-radius:42px;padding:55px 50px}.panel .title{margin:35px 0 15px;font-size:104px}.panel .subtitle{margin:0}.counter{position:absolute;right:50px;top:56px;color:#fb7353;font-size:27px;font-weight:800}.mark{position:absolute;left:92px;top:96px;color:white;font-weight:800;font-size:36px}`) + rootOpen(6) + `<div class="canvas" id="canvas" data-start="0" data-duration="6" data-track-index="0"></div><div class="photo" id="photo" data-qj-image="imageUrl" data-start="0" data-duration="6" data-track-index="1"></div><div class="blob" id="blob" data-start="0" data-duration="6" data-track-index="2"></div><div class="mark" id="mark" data-start="0" data-duration="6" data-track-index="3">轻剪 · 生活影像</div><section class="panel" id="panel" data-start="0" data-duration="6" data-track-index="4"><div class="eyebrow" id="eyebrow" data-qj-field="eyebrow" data-start="0" data-duration="6" data-track-index="5"></div><h1 class="title" id="title" data-qj-field="title" data-start="0" data-duration="6" data-track-index="6"></h1><p class="subtitle" id="subtitle" data-qj-field="subtitle" data-start="0" data-duration="6" data-track-index="7"></p><div class="counter" id="counter" data-start="0" data-duration="6" data-track-index="8">02 / 03</div></section>` + tail(`const tl=gsap.timeline({paused:true});QJMotion.splitWipe(tl,'#photo',.18);QJMotion.imageDrift(tl,'#photo',.38,5.2);QJMotion.cardPop(tl,'#panel',.72);QJMotion.textRise(tl,'#eyebrow',.94);QJMotion.textRise(tl,'#title',1.14);QJMotion.textRise(tl,'#subtitle',1.42);tl.fromTo('#mark',{opacity:0},{opacity:1,duration:.4,ease:'sine.out'},.72);tl.fromTo('#counter',{opacity:0,scale:.8},{opacity:1,scale:1,duration:.34,ease:'back.out(1.3)'},1.6);`); }
function captionHtml(): string { return head(`.bg{position:absolute;inset:0;background:linear-gradient(150deg,#fff4e8,#f8d4bb 47%,#fffcf9)}.circle{position:absolute;top:90px;left:600px;width:900px;height:900px;border-radius:50%;background:#ffd9bb}.frame{position:absolute;top:288px;left:77px;width:926px;height:1320px;border:3px solid rgba(251,115,83,.45);border-radius:58px}.quote{position:absolute;top:510px;left:120px;right:120px;font-size:76px;line-height:1.45;font-weight:800;letter-spacing:-.04em}.quote strong{color:#fb7353}.tag{position:absolute;left:120px;top:390px}.sub{position:absolute;left:120px;right:120px;top:1060px}.rule{position:absolute;left:120px;top:1245px}.brand{position:absolute;bottom:160px;left:120px}.end{position:absolute;bottom:165px;right:120px;color:#9f7061;font-size:30px}`) + rootOpen(6) + `<div class="bg" id="bg" data-start="0" data-duration="6" data-track-index="0"></div><div class="circle" id="circle" data-start="0" data-duration="6" data-track-index="1"></div><div class="frame" id="frame" data-start="0" data-duration="6" data-track-index="2"></div><div class="eyebrow tag" id="eyebrow" data-qj-field="eyebrow" data-start="0" data-duration="6" data-track-index="3"></div><div class="quote" id="quote" data-start="0" data-duration="6" data-track-index="4"><span id="title" data-qj-field="title"></span><strong> ·</strong></div><p class="subtitle sub" id="subtitle" data-qj-field="subtitle" data-start="0" data-duration="6" data-track-index="5"></p><div class="line rule" id="line" data-start="0" data-duration="6" data-track-index="6"></div><div class="brand" id="brand" data-start="0" data-duration="6" data-track-index="7">轻剪<i>.</i></div><div class="end" id="end" data-start="0" data-duration="6" data-track-index="8">把故事继续讲下去 →</div>` + tail(`const tl=gsap.timeline({paused:true});tl.fromTo('#circle',{scale:.65,opacity:0},{scale:1,opacity:1,duration:1.1,ease:'sine.out'},.16);QJMotion.splitWipe(tl,'#frame',.3);QJMotion.textRise(tl,'#eyebrow',.6);QJMotion.textRise(tl,'#quote',.82);QJMotion.textRise(tl,'#subtitle',1.35);QJMotion.lineDraw(tl,'#line',1.65);tl.fromTo('#brand,#end',{opacity:0,y:30},{opacity:1,y:0,duration:.55,ease:'power2.out',stagger:.15},1.82);`); }

const seed = (): HtmlEffect[] => {
  const now = new Date().toISOString();
  return [
    { id: 'sunny-opening', name: '阳光开场', description: '拱形海岸与大标题，适合旅行视频开头。', html: openingHtml(), duration: 6, width: 1080, height: 1920, enabled: true, defaults: { ...blankValues }, createdAt: now, updatedAt: now },
    { id: 'photo-drift', name: '照片推镜', description: '照片缓慢推镜，底部卡片承载地点和故事。', html: photoHtml(), duration: 6, width: 1080, height: 1920, enabled: true, defaults: { ...blankValues, eyebrow: 'TRAVEL NOTE · 02', title: '沿着海风走', subtitle: '每一步都有新的风景。' }, createdAt: now, updatedAt: now },
    { id: 'story-outro', name: '故事收束', description: '温暖的引用字幕和品牌落版。', html: captionHtml(), duration: 6, width: 1080, height: 1920, enabled: true, defaults: { ...blankValues, eyebrow: 'THE END · 03', title: '好故事，值得被看见', subtitle: '下一段旅程，从一句话开始。' }, createdAt: now, updatedAt: now },
    { id: 'argument-card', name: '观点强调', description: '用一句观点和一行原话摘要建立信息重点，适合口播章节提示。', html: argumentHtml(), duration: 6, width: 1080, height: 1920, enabled: true, defaults: { ...blankValues, eyebrow: '核心观点', title: '先理解原声，再做精剪', subtitle: '保留完整原话，让每一次剪切都有依据。' }, createdAt: now, updatedAt: now },
    ...richMotionTemplates().map(({title,subtitle,...item})=>({...item,duration:6,width:1080,height:1920,enabled:true,defaults:{...blankValues,eyebrow:'轻剪 · 信息可视化',title,subtitle},createdAt:now,updatedAt:now})),
    { id: 'compare-card', name: '观点对比', description: '标题与解释依次揭示，对比方法、误区和结论。', html: argumentHtml(true), duration: 6, width: 1080, height: 1920, enabled: true, defaults: { ...blankValues, eyebrow: '方法对比', title: '从按时长截取，到按观点组织', subtitle: '看懂上下文，保留论证与结论。' }, createdAt: now, updatedAt: now },
  ];
};

function argumentHtml(compare = false): string {
  const css = `.scene-content{width:100%;height:100%;padding:180px 90px 210px;display:flex;flex-direction:column;justify-content:center;gap:55px}.point{font-size:84px;text-wrap:balance;line-height:1.3;font-weight:800;letter-spacing:-.04em;overflow-wrap:anywhere;margin:0}.explain{font-size:43px;line-height:1.65;font-weight:400;margin:0}.point-card{padding:64px 54px;background:#fff0e9;border-radius:36px}.progress{height:8px;background:#fb7353;border-radius:4px}.label{font-size:30px;font-weight:700;color:#866d62}.decoration{position:absolute;width:600px;height:600px;right:-350px;top:90px;border:3px solid #fb7353;border-radius:50%;opacity:.18;pointer-events:none}`;
  const content = `<div class="decoration clip" id="decoration" data-layout-ignore data-start="0" data-duration="6" data-track-index="0"></div><section class="scene-content"><div class="label clip" id="eyebrow" data-qj-field="eyebrow" data-start="0" data-duration="6" data-track-index="1"></div><div class="point-card" id="point-card"><h1 class="point clip" id="title" data-qj-field="title" data-start="0" data-duration="6" data-track-index="2"></h1></div><p class="explain clip" id="subtitle" data-qj-field="subtitle" data-start="0" data-duration="6" data-track-index="3"></p><div class="progress clip" id="progress" data-start="0" data-duration="6" data-track-index="4"></div></section>`;
  const script = `const tl=gsap.timeline({paused:true});tl.from('#decoration',{scale:.92,duration:5.6,ease:'sine.out'},.2);QJMotion.lowerThird(tl,'#eyebrow',.22);${compare ? "QJMotion.compareReveal(tl,'#title,#subtitle',.55);tl.from('#point-card',{scale:.97,opacity:0,duration:.55,ease:'sine.out'},.4);" : "QJMotion.keywordPunch(tl,'#point-card',.5);QJMotion.textRise(tl,'#title',.7);QJMotion.lowerThird(tl,'#subtitle',1.05);"}QJMotion.chapterProgress(tl,'#progress',.3,5.2);`;
  return head(css) + rootOpen(6) + content + tail(script);
}

function checkEffect(input: Partial<HtmlEffect>): void {
  if (!input.name?.trim() || input.name.length > 80) throw new Error('请填写 80 字以内的特效名称。');
  if (typeof input.html !== 'string' || input.html.length > 150_000 || !input.html.includes('data-composition-id="main"') || !input.html.includes('<!--QJ_RUNTIME-->') || !input.html.includes('<!--QJ_DATA-->') || !input.html.includes('window.__timelines["main"]')) throw new Error('HTML 必须包含 main 合成、运行时及数据插槽，并注册时间轴。');
  if (!Number.isFinite(input.duration) || input.duration! < 1 || input.duration! > 15) throw new Error('时长需为 1–15 秒。');
  if (![[1080,1920],[1920,1080],[1080,1080]].some(([w,h]) => input.width === w && input.height === h)) throw new Error('画幅仅支持 9:16、16:9 或 1:1。');
}
function normalizeValues(input: Partial<EffectValues> = {}, fallback: EffectValues): EffectValues {
  const values = { ...fallback };
  for (const key of ['eyebrow','title','subtitle'] as const) if (typeof input[key] === 'string') values[key] = input[key]!.slice(0, key === 'title' ? 60 : 120);
  if (typeof input.imageUrl === 'string') values.imageUrl = /^https:\/\//.test(input.imageUrl) ? input.imageUrl.slice(0, 2000) : '';
  if (typeof input.videoUrl === 'string') values.videoUrl = /^https:\/\//.test(input.videoUrl) ? input.videoUrl.slice(0, 2000) : '';
  if (typeof input.assetId === 'string') values.assetId = /^[0-9a-f-]{36}$/i.test(input.assetId) ? input.assetId : '';
  if (typeof input.accent === 'string' && allowedAccent.test(input.accent)) values.accent = input.accent;
  return values;
}
const safeJson = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');

export function createEffectStore(dataDir: string, oss?: ReturnType<typeof createOssStorage>) {
  const dir = path.join(dataDir, 'html-effects');
  const catalogFile = path.join(dir, 'catalog.json');
  const rendersFile = path.join(dir, 'renders.json');
  const assetsFile = path.join(dir, 'assets.json');
  const assetsDir = path.join(dir, 'assets');
  const uploadsDir = path.join(dir, 'uploads');
  const rendersDir = path.join(dir, 'renders');
  let catalog: HtmlEffect[] = [];
  let assets: EffectAsset[] = [];
  const renders = new Map<string, EffectRender>();
  let saving = Promise.resolve();
  let savingAssets = Promise.resolve();
  let savingRenders = Promise.resolve();
  let rendering = false;
  const save = () => {
    const data = JSON.stringify(catalog, null, 2);
    saving = saving.catch(() => undefined).then(async () => { const temp = `${catalogFile}.${randomUUID()}.tmp`; await writeFile(temp, data, { mode: 0o600 }); await rename(temp, catalogFile); });
    return saving;
  };
  const saveRenders = () => {
    const data = JSON.stringify([...renders.values()].slice(-100), null, 2);
    savingRenders = savingRenders.catch(() => undefined).then(async () => { const temp = `${rendersFile}.${randomUUID()}.tmp`; await writeFile(temp, data, { mode: 0o600 }); await rename(temp, rendersFile); });
    return savingRenders;
  };
  const saveAssets = () => {
    const data = JSON.stringify(assets, null, 2);
    savingAssets = savingAssets.catch(() => undefined).then(async () => { const temp = `${assetsFile}.${randomUUID()}.tmp`; await writeFile(temp, data, { mode: 0o600 }); await rename(temp, assetsFile); });
    return savingAssets;
  };
  async function init() {
    await Promise.all([rendersDir, assetsDir, uploadsDir].map((item) => mkdir(item, { recursive: true })));
    try { catalog = JSON.parse(await readFile(catalogFile, 'utf8')) as HtmlEffect[]; if (!Array.isArray(catalog)) throw new Error('invalid'); }
    catch { catalog = seed(); await save(); }
    // Upgrade once; preserve administrator customizations and later deletions.
    const motionUpgrade = path.join(dir, 'motion-v2');
    if (!(await stat(motionUpgrade).catch(() => undefined))) {
      for (const effect of seed().filter((item) => ['argument-card', 'compare-card'].includes(item.id))) if (!get(effect.id)) catalog.push(effect);
      await save(); await writeFile(motionUpgrade, '2\n', { mode: 0o600 });
    }
    const designUpgrade = path.join(dir, 'motion-design-v1');
    if (!(await stat(designUpgrade).catch(() => undefined))) {
      for (const effect of seed().filter(item => richMotionIds.includes(item.id))) if (!get(effect.id)) catalog.push(effect);
      await save(); await writeFile(designUpgrade, '1\n', { mode: 0o600 });
    }
    assets = await readFile(assetsFile, 'utf8').then((value) => JSON.parse(value) as EffectAsset[]).catch(() => []);
    if (!Array.isArray(assets)) assets = [];
    const previous = await readFile(rendersFile, 'utf8').then((value) => JSON.parse(value) as EffectRender[]).catch(() => []);
    if (Array.isArray(previous)) for (const item of previous) {
      if (item.status === 'queued' || item.status === 'running') { item.status = 'failed'; item.error = '服务重启导致渲染中断，请重新生成。'; }
      renders.set(item.id, item);
    }
    await saveRenders();
  }
  const list = () => catalog.map((item) => ({ ...item }));
  const get = (id: string) => catalog.find((item) => item.id === id);
  const getAsset = (id: string) => assets.find((item) => item.id === id);
  const assetFile = (asset: EffectAsset) => path.join(assetsDir, `${asset.id}.${asset.mimeType === 'image/jpeg' ? 'jpg' : asset.mimeType === 'image/png' ? 'png' : asset.mimeType === 'image/webp' ? 'webp' : asset.mimeType === 'video/webm' ? 'webm' : asset.mimeType === 'video/quicktime' ? 'mov' : 'mp4'}`);
  async function saveAsset(file: string, name: string, mimeType: string): Promise<EffectAsset> {
    const kind = mimeType.startsWith('image/') ? 'image' : mimeType.startsWith('video/') ? 'video' : null;
    if (!kind || !['image/jpeg','image/png','image/webp','video/mp4','video/webm','video/quicktime'].includes(mimeType)) throw new Error('仅支持 JPG、PNG、WebP、MP4、WebM 或 MOV 文件。');
    const size = (await stat(file)).size;
    if (!size || size > (kind === 'image' ? MAX_EFFECT_IMAGE_UPLOAD_BYTES : MAX_MEDIA_UPLOAD_BYTES)) throw new Error(kind === 'image' ? '图片不能超过 20 MB。' : '视频不能超过 100 MB，请先压缩。');
    if (kind === 'image' && detectImage(await readFile(file)) !== mimeType) throw new Error('图片文件内容与格式不匹配。');
    if (kind === 'video') await probeVideo(file);
    const asset: EffectAsset = { id: randomUUID(), name: path.basename(name).slice(0, 120), kind, mimeType, size, createdAt: new Date().toISOString() };
    const destination = assetFile(asset);
    try {
      await rename(file, destination);
      await oss?.put('admin-effects', 'media', asset.id, destination, mimeType);
      assets.push(asset); await saveAssets();
      return asset;
    } catch (error) {
      await rm(destination, { force: true });
      await oss?.remove('admin-effects', 'media', asset.id).catch(() => undefined);
      throw error;
    }
  }
  async function ensureAsset(asset: EffectAsset): Promise<string> {
    const file = assetFile(asset);
    await oss?.ensure('admin-effects', 'media', asset.id, file);
    return file;
  }
  async function upsert(input: Partial<HtmlEffect>, id?: string) {
    checkEffect(input);
    const existing = id ? get(id) : undefined;
    if (id && !existing) throw new Error('特效不存在。');
    const now = new Date().toISOString();
    const item: HtmlEffect = { id: existing?.id || randomUUID(), name: input.name!.trim(), description: String(input.description || '').slice(0, 240), html: input.html!, duration: input.duration!, width: input.width!, height: input.height!, enabled: input.enabled !== false, defaults: normalizeValues(input.defaults, existing?.defaults || blankValues), createdAt: existing?.createdAt || now, updatedAt: now };
    if (existing) catalog = catalog.map((value) => value.id === existing.id ? item : value); else catalog.push(item);
    await save(); return item;
  }
  async function remove(id: string) { if (!get(id)) throw new Error('特效不存在。'); catalog = catalog.filter((item) => item.id !== id); await save(); }
  const listAssets = () => [...assets].reverse();
  const publicAssetUrl = (asset: EffectAsset, fallback: string) => oss?.publicUrl('admin-effects', 'media', asset.id) || fallback;
  async function compile(effect: HtmlEffect, input?: Partial<EffectValues>, preview = false, assetUrl?: string, sourceKind?: 'image' | 'video', externalRuntime = false): Promise<string> {
    const gsap = externalRuntime ? '' : await readFile(gsapPath, 'utf8');
    const values = normalizeValues(input, effect.defaults);
    if (values.assetId) {
      const asset = getAsset(values.assetId);
      if (!asset || !assetUrl) throw new Error('所选素材不存在，请重新上传。');
      values.imageUrl = asset.kind === 'image' ? assetUrl : '';
      values.videoUrl = asset.kind === 'video' ? assetUrl : '';
    } else if (assetUrl && sourceKind) {
      values.imageUrl = sourceKind === 'image' ? assetUrl : '';
      values.videoUrl = sourceKind === 'video' ? assetUrl : '';
    }
    const dataScript = `window.__QJ_DATA__=${safeJson(values)};window.__QJ_PREVIEW__=${preview};window.__timelines=window.__timelines||{};document.querySelectorAll('[data-qj-field]').forEach(el=>{el.textContent=window.__QJ_DATA__[el.dataset.qjField]||''});document.querySelectorAll('[data-qj-image]').forEach(el=>{const image=window.__QJ_DATA__[el.dataset.qjImage];const video=window.__QJ_DATA__.videoUrl;if(video){el.style.backgroundImage='none';if(getComputedStyle(el).position==='static')el.style.position='relative';const media=document.createElement('video');media.src=video;media.muted=true;media.autoplay=true;media.playsInline=true;media.loop=true;media.setAttribute('data-start','0');media.setAttribute('data-duration','${effect.duration}');media.setAttribute('data-track-index','0');media.setAttribute('data-volume','0');Object.assign(media.style,{position:'absolute',inset:'0',width:'100%',height:'100%',objectFit:'cover'});el.appendChild(media)}else if(image)el.style.backgroundImage='url('+JSON.stringify(image)+')'});document.documentElement.style.setProperty('--qj-accent',window.__QJ_DATA__.accent);document.documentElement.style.setProperty('--qj-width','${effect.width}px');document.documentElement.style.setProperty('--qj-height','${effect.height}px');`;
    const runtime = externalRuntime ? '<script src="./gsap.min.js"></script>' : `<script>${gsap.replace(/<\/script/gi, '<\\/script')}</script>`;
    return effect.html.replace('<!--QJ_RUNTIME-->', `${runtime}<script>${motionLibrary}</script>`).replace('<!--QJ_DATA-->', `<script>${dataScript}</script>`).replace(/data-duration="[^"]*"(?=[^>]*data-width)/, `data-duration="${effect.duration}"`).replace(/data-width="[^"]*"/, `data-width="${effect.width}"`).replace(/data-height="[^"]*"/, `data-height="${effect.height}"`);
  }
  async function render(effect: HtmlEffect, values?: Partial<EffectValues>, sourceMedia?: EffectSourceMedia): Promise<EffectRender> {
    if (rendering) throw new Error('已有特效正在渲染，请稍后再试。');
    rendering = true;
    const id = randomUUID(); const createdAt = new Date().toISOString();
    const job: EffectRender = { id, effectId: effect.id, status: 'queued', createdAt }; renders.set(id, job); await saveRenders();
    const workDir = path.join(dir, `job-${id}`); const output = path.join(rendersDir, `${id}.mp4`);
    void (async () => {
      try {
        job.status = 'running'; await saveRenders(); await mkdir(workDir, { recursive: true });
        let localAssetUrl: string | undefined;
        if (values?.assetId) {
          const asset = getAsset(values.assetId);
          if (!asset) throw new Error('所选素材不存在，请重新上传。');
          const source = await ensureAsset(asset);
          await mkdir(path.join(workDir, 'assets'), { recursive: true });
          localAssetUrl = `./assets/${path.basename(source)}`;
          await copyFile(source, path.join(workDir, localAssetUrl));
        } else if (sourceMedia) {
          const extension = sourceMedia.mimeType === 'image/png' ? 'png' : sourceMedia.mimeType === 'image/webp' ? 'webp' : sourceMedia.mimeType === 'image/jpeg' ? 'jpg' : sourceMedia.mimeType === 'video/webm' ? 'webm' : sourceMedia.mimeType === 'video/quicktime' ? 'mov' : 'mp4';
          await mkdir(path.join(workDir, 'assets'), { recursive: true });
          localAssetUrl = `./assets/source.${extension}`;
          await copyFile(sourceMedia.file, path.join(workDir, localAssetUrl));
        }
        await copyFile(gsapPath, path.join(workDir, 'gsap.min.js'));
        await writeFile(path.join(workDir, 'index.html'), await compile(effect, values, false, localAssetUrl, sourceMedia?.kind, true), 'utf8');
        await new Promise<void>((resolve, reject) => {
          const child = spawn(cliPath, ['render', workDir, '-o', output, '--fps', '24', '--quality', 'draft', '--workers', '1'], { cwd: root, env: { ...process.env, HYPERFRAMES_FFMPEG_PATH: process.env.HYPERFRAMES_FFMPEG_PATH || ffmpegPath || undefined, HYPERFRAMES_FFPROBE_PATH: process.env.HYPERFRAMES_FFPROBE_PATH || ffprobePath, PATH: `${path.join(root,'node_modules','.bin')}:${process.env.PATH || ''}` }, stdio: ['ignore','pipe','pipe'] });
          let log = ''; const append = (chunk: Buffer) => { log = (log + chunk.toString()).slice(-6000); };
          child.stdout.on('data', append); child.stderr.on('data', append);
          const timer = setTimeout(() => child.kill('SIGTERM'), 180_000);
          child.on('error', reject); child.on('close', (code) => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`渲染失败（退出码 ${code}）：${log.slice(-500)}`)); });
        });
        if ((await stat(output)).size < 1000) throw new Error('渲染文件为空。');
        job.status = 'succeeded'; job.file = output;
      } catch (error) { job.status = 'failed'; job.error = error instanceof Error ? error.message : '渲染失败。'; await rm(output, { force: true }); }
      finally { await saveRenders(); await rm(workDir, { recursive: true, force: true }); rendering = false; }
    })();
    return job;
  }
  return { init, list, get, upsert, remove, compile, render, listAssets, getAsset, saveAsset, ensureAsset, publicAssetUrl, uploadsDir, getRender: (id: string) => renders.get(id), listRenders: () => [...renders.values()].reverse(), rendersDir };
}
