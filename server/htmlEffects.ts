import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface EffectValues { eyebrow: string; title: string; subtitle: string; imageUrl: string; accent: string }
export interface HtmlEffect {
  id: string; name: string; description: string; html: string; duration: number;
  width: number; height: number; enabled: boolean; defaults: EffectValues;
  createdAt: string; updatedAt: string;
}
export interface EffectRender { id: string; effectId: string; status: 'queued' | 'running' | 'succeeded' | 'failed'; createdAt: string; file?: string; error?: string }

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const gsapPath = path.join(root, 'node_modules', 'gsap', 'dist', 'gsap.min.js');
const cliPath = path.join(root, 'node_modules', '.bin', 'hyperframes');
const allowedAccent = /^#[0-9a-fA-F]{6}$/;
const blankValues: EffectValues = { eyebrow: '轻剪 · YOUR STORY', title: '去看更大的世界', subtitle: '把今天，剪成值得收藏的片段。', imageUrl: '', accent: '#fb7353' };

// This is the product motion library. Each primitive adds frame-addressable GSAP tweens.
export const motionLibrary = `window.QJMotion = Object.freeze({
  textRise(tl, selector, at=0.2) { return tl.fromTo(selector,{y:90,opacity:0,filter:'blur(14px)'},{y:0,opacity:1,filter:'blur(0px)',duration:0.68,ease:'power3.out'},at); },
  cardPop(tl, selector, at=0.35) { return tl.fromTo(selector,{scale:0.86,opacity:0,rotation:-3},{scale:1,opacity:1,rotation:0,duration:0.82,ease:'back.out(1.3)'},at); },
  lineDraw(tl, selector, at=0.7) { return tl.fromTo(selector,{scaleX:0,transformOrigin:'left center'},{scaleX:1,duration:0.42,ease:'expo.out'},at); },
  imageDrift(tl, selector, at=0.2, duration=4.8) { return tl.fromTo(selector,{scale:1.08,x:-24},{scale:1.17,x:24,duration,ease:'none'},at); },
  splitWipe(tl, selector, at=0.18) { return tl.fromTo(selector,{clipPath:'inset(0 100% 0 0)'},{clipPath:'inset(0 0% 0 0)',duration:0.76,ease:'power4.out'},at); },
  fadeOut(tl, selector, at, duration=0.3) { return tl.to(selector,{opacity:0,y:-18,duration,ease:'power2.in'},at); }
});`;

const baseCss = `*{box-sizing:border-box}html,body{margin:0;width:var(--qj-width,1080px);height:var(--qj-height,1920px);overflow:hidden;background:#fffdfa;font-family:"PingFang SC","Microsoft YaHei",Arial,sans-serif;color:#252935}#root{position:relative;width:var(--qj-width,1080px);height:var(--qj-height,1920px);overflow:hidden;background:#fffdfa}.eyebrow{font-size:30px;letter-spacing:.22em;font-weight:700;color:#866d62}.title{font-size:118px;line-height:1.15;font-weight:800;letter-spacing:-.045em}.subtitle{font-size:43px;line-height:1.5;color:#625b59}.brand{font-size:42px;font-weight:800;letter-spacing:-.08em}.brand i{color:var(--qj-accent,#fb7353);font-style:normal}.line{height:7px;width:250px;border-radius:8px;background:var(--qj-accent,#fb7353)}.photo{background:linear-gradient(145deg,#c5e8ed 0%,#7bbbd0 38%,#ecb98f 63%,#e78163 100%);background-position:center;background-size:cover}.safe{position:absolute;left:90px;right:90px}`;
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
  ];
};

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
  if (typeof input.accent === 'string' && allowedAccent.test(input.accent)) values.accent = input.accent;
  return values;
}
const safeJson = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');

export function createEffectStore(dataDir: string) {
  const dir = path.join(dataDir, 'html-effects');
  const catalogFile = path.join(dir, 'catalog.json');
  const rendersFile = path.join(dir, 'renders.json');
  const rendersDir = path.join(dir, 'renders');
  let catalog: HtmlEffect[] = [];
  const renders = new Map<string, EffectRender>();
  let saving = Promise.resolve();
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
  async function init() {
    await mkdir(rendersDir, { recursive: true });
    try { catalog = JSON.parse(await readFile(catalogFile, 'utf8')) as HtmlEffect[]; if (!Array.isArray(catalog)) throw new Error('invalid'); }
    catch { catalog = seed(); await save(); }
    const previous = await readFile(rendersFile, 'utf8').then((value) => JSON.parse(value) as EffectRender[]).catch(() => []);
    if (Array.isArray(previous)) for (const item of previous) {
      if (item.status === 'queued' || item.status === 'running') { item.status = 'failed'; item.error = '服务重启导致渲染中断，请重新生成。'; }
      renders.set(item.id, item);
    }
    await saveRenders();
  }
  const list = () => catalog.map((item) => ({ ...item }));
  const get = (id: string) => catalog.find((item) => item.id === id);
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
  async function compile(effect: HtmlEffect, input?: Partial<EffectValues>, preview = false): Promise<string> {
    const gsap = await readFile(gsapPath, 'utf8');
    const values = normalizeValues(input, effect.defaults);
    const dataScript = `window.__QJ_DATA__=${safeJson(values)};window.__QJ_PREVIEW__=${preview};window.__timelines=window.__timelines||{};document.querySelectorAll('[data-qj-field]').forEach(el=>{el.textContent=window.__QJ_DATA__[el.dataset.qjField]||''});document.querySelectorAll('[data-qj-image]').forEach(el=>{const url=window.__QJ_DATA__[el.dataset.qjImage];if(url)el.style.backgroundImage='url('+JSON.stringify(url)+')'});document.documentElement.style.setProperty('--qj-accent',window.__QJ_DATA__.accent);document.documentElement.style.setProperty('--qj-width','${effect.width}px');document.documentElement.style.setProperty('--qj-height','${effect.height}px');`;
    return effect.html.replace('<!--QJ_RUNTIME-->', `<script>${gsap.replace(/<\/script/gi, '<\\/script')}</script><script>${motionLibrary}</script>`).replace('<!--QJ_DATA-->', `<script>${dataScript}</script>`).replace(/data-duration="[^"]*"(?=[^>]*data-width)/, `data-duration="${effect.duration}"`).replace(/data-width="[^"]*"/, `data-width="${effect.width}"`).replace(/data-height="[^"]*"/, `data-height="${effect.height}"`);
  }
  async function render(effect: HtmlEffect, values?: Partial<EffectValues>): Promise<EffectRender> {
    if (rendering) throw new Error('已有特效正在渲染，请稍后再试。');
    rendering = true;
    const id = randomUUID(); const createdAt = new Date().toISOString();
    const job: EffectRender = { id, effectId: effect.id, status: 'queued', createdAt }; renders.set(id, job); await saveRenders();
    const workDir = path.join(dir, `job-${id}`); const output = path.join(rendersDir, `${id}.mp4`);
    void (async () => {
      try {
        job.status = 'running'; await saveRenders(); await mkdir(workDir, { recursive: true });
        await writeFile(path.join(workDir, 'index.html'), await compile(effect, values), 'utf8');
        await new Promise<void>((resolve, reject) => {
          const child = spawn(cliPath, ['render', workDir, '-o', output, '--fps', '24', '--quality', 'draft', '--workers', '1'], { cwd: root, env: { ...process.env, PATH: `${path.join(root,'node_modules','.bin')}:${process.env.PATH || ''}` }, stdio: ['ignore','pipe','pipe'] });
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
  return { init, list, get, upsert, remove, compile, render, getRender: (id: string) => renders.get(id), listRenders: () => [...renders.values()].reverse(), rendersDir };
}
