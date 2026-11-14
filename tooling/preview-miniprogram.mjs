// Local visual harness for the official component simulator. It uses fixture
// data and never authenticates to or calls the production service.
import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), project = path.join(repo, 'apps/miniprogram'), root = path.join(project, 'miniprogram');
const req = createRequire(path.join(project, 'package.json'));
const sdk = await readFile(path.join(path.dirname(req.resolve('miniprogram-simulate')), 'build.js'), 'utf8');
const compiler = createRequire(req.resolve('miniprogram-simulate'))('miniprogram-compiler');
const compiled = compiler.wxmlToJs(root, { maxBuffer: 4 * 1024 * 1024 });
const config = JSON.parse(await readFile(path.join(root, 'app.json'), 'utf8'));
const fileMap = {};
const halfRpx = value => value.replace(/(\d+(?:\.\d+)?)rpx/g, (_, amount) => Number(amount) / 2 + 'px').replace(/(?<![.\w-])(?:view|button|input|textarea|text|image|video|progress)(?![\w-])/g, tag => 'wx-' + tag);
async function collect(directory, prefix = '') {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) await collect(path.join(directory, entry.name), name);
    else if (/\.(js|json|wxss)$/.test(name)) { const content = await readFile(path.join(directory, entry.name), 'utf8'); fileMap['mini/' + name] = name.endsWith('.wxss') ? halfRpx(content) : content; }
  }
}
await collect(root);
const stickerAssets=path.join(repo,'skills/qingmao-stickers/assets');
const stickerSource=JSON.parse(await readFile(path.join(stickerAssets,'pack.json'),'utf8'));
const stickerPack={id:stickerSource.id,name:stickerSource.name,version:stickerSource.version,count:24,defaultSceneIds:stickerSource.defaultSceneIds,
  sampleUrl:'/api/templates/qingmao-stickers/sample/video',posterUrl:'/api/templates/qingmao-stickers/sample/poster',
  items:stickerSource.items.map(item=>({...item,thumbnailUrl:`/api/sticker-packs/${stickerSource.id}/items/${item.id}/thumb`,previewUrl:`/api/sticker-packs/${stickerSource.id}/items/${item.id}/preview`}))};
const stickerTemplate={...JSON.parse(await readFile(path.join(repo,'skills/qingmao-stickers/template.json'),'utf8')),output:'sticker-pack',skillName:'qingmao-stickers'};
stickerTemplate.sample={...stickerTemplate.sample,videoUrl:stickerPack.sampleUrl,posterUrl:stickerPack.posterUrl};
async function readStyle(file){let source=await readFile(file,'utf8');for(const match of [...source.matchAll(/@import\s+["']([^"']+)["'];/g)])source=source.replace(match[0],await readStyle(path.resolve(path.dirname(file),match[1])));return source;}
const globalStyle = halfRpx(await readStyle(path.join(root, 'app.wxss'))).replace(/(^|\})\s*page\s*\{/g, '$1 body {').replace(/(?<!\d)\.([-a-zA-Z][\w-]*)/g, '.main--$1');
const browserScript = `
window.__FILE_MAP__ = ${JSON.stringify(fileMap)};
const gwx = (function(){${compiled}})();
${JSON.stringify(config.pages.concat('components/privacy/index'))}.forEach(p => window.__FILE_MAP__['mini/'+p+'.wxml'] = gwx(p+'.wxml'));
const wallet = { balance:2000, dailyGrant:1000, registrationGrant:2000, pointValueRmb:.001, totalSpent:0, checkInDate:'2026-10-06', canCheckIn:true, special:false };
const state = { activeSessionId:'preview-session',sessions:[{id:'preview-session',title:'新会话',messages:[],updatedAt:'2026-10-06T08:00:00Z',modelId:'doubao'}],jobs:[],media:[],artifacts:[],settings:{defaultModelId:'doubao'},credits:wallet,models:[{id:'doubao',name:'豆包 Seed 2.1 Pro',kind:'text',enabled:true},{id:'deepseek',name:'DeepSeek V4 Pro',kind:'text',enabled:true},{id:'glm',name:'GLM 5.3 Flash',kind:'text',enabled:true}] };
const listeners=new Set(); let claimed=false;
state.templates=${JSON.stringify([stickerTemplate])};
const app={state,user:{displayName:'示例创作者',email:'',authProvider:'wechat'},subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn)},refresh:async()=>state,apply(value){this.state=value;listeners.forEach(fn=>fn(value));return value},applyWallet(wallet){state.credits=wallet;this.apply(state)},
 client:{hasSession:()=>new URL(location.href).searchParams.get('page')!=='auth',previewUrl:()=>'',async wechatLogin(){throw Error('示例页面不连接微信，请在微信开发者工具中登录。')},async request(route,body){if(route==='/api/auth/wechat/profile'){app.user.displayName=body.displayName;return{user:app.user}}if(route==='/api/auth/me')return{user:app.user};if(route.startsWith('/api/credits')){if(route.endsWith('/check-in')){const first=!claimed;claimed=true;if(first){wallet.balance+=1000;wallet.canCheckIn=false}return{wallet,claimed:first,points:first?1000:0,date:wallet.checkInDate}}return{wallet,entries:[...(claimed?[{id:'daily',kind:'daily_checkin',points:1000,at:'2026-10-06T09:00:00Z'}]:[]),{id:'gift',kind:'signup_grant',points:2000,at:'2026-10-06T08:00:00Z'}],total:claimed?2:1}}throw Error('组件预览不连接生产服务')},clear(){}},async mutate(route,body){if(route==='/api/settings'){state.settings.defaultModelId=body.defaultModelId;state.sessions[0].modelId=body.defaultModelId;return this.apply(state)}throw Error('组件预览不执行制作任务，请在微信中测试。')},expired(){location.href='/preview?page=auth'}};
window.getApp=()=>app;window.getCurrentPages=()=>[];
const originalRequest=app.client.request;app.client.templateAssetUrl=route=>route;app.client.request=async(route,body)=>route==='/api/sticker-packs'?{packs:[${JSON.stringify(stickerPack)}]}:route==='/api/templates'?{templates:state.templates}:originalRequest(route,body);
const navigate=options=>{const match=/pages\\/(\\w+)\\/index/.exec(options.url);if(match)location.href='/preview?page='+match[1]};
window.wx={getRecorderManager:()=>({onStart(){},onStop(){},onError(){},offStart(){},offStop(){},offError(){},stop(){}}),requirePrivacyAuthorize:o=>o.success(),authorize:o=>o.success(),showToast:o=>{document.getElementById('toast').textContent=o.title},navigateTo:navigate,switchTab:navigate,reLaunch:navigate,setNavigationBarTitle(){},getStorageSync(){},removeStorageSync(){}};
`;
const runtime = `
window.Page = options=>{const {data,...methods}=options;window.Component({data,methods})};
const name=new URL(location.href).searchParams.get('page')||'chat';
const known=${JSON.stringify(config.pages)};
if(!known.includes('pages/'+name+'/index'))throw Error('unknown preview page');
const id=simulate.load('mini/pages/'+name+'/index',{compiler:'official',rootPath:'mini',usingComponents:${JSON.stringify(config.usingComponents)}});
const page=simulate.render(id);page.attach(document.getElementById('preview'));
window.__miniPreview=page;
const nativeSetData=page.instance.setData.bind(page.instance);page.instance.setData=(patch,callback)=>{nativeSetData(patch,callback);queueMicrotask(wire)};
if(page.instance.onLoad)page.instance.onLoad({type:new URL(location.href).searchParams.get('type')||'privacy'});
if(page.instance.onShow)page.instance.onShow();
const attached=new WeakSet();
function wire(){
 const positions={};
 function visit(node){
  if(!node||typeof node!=='object')return;
  const tag=node.tagName;
  if(tag&&tag.startsWith('wx-')){
   const index=positions[tag]||0;positions[tag]=index+1;
   const el=document.getElementById('preview').querySelectorAll(tag)[index];
   if(el){
    const attrs=Object.fromEntries((node.attrs||[]).map(a=>[a.name,a.value]));
    if(tag==='wx-image'){
     let image=el.querySelector('img');if(!image){image=document.createElement('img');image.style.cssText='display:block;width:100%;height:100%;object-fit:contain';el.appendChild(image)}
     if(image.getAttribute('src')!==attrs.src)image.setAttribute('src',attrs.src||'');
    }
    if(tag==='wx-video'){
     let video=el.querySelector('video');if(!video){video=document.createElement('video');video.style.cssText='width:100%;height:100%;object-fit:contain';video.controls=true;video.preload='metadata';el.style.display='block';el.appendChild(video)}
     if(video.getAttribute('src')!==attrs.src)video.setAttribute('src',attrs.src||'');if(attrs.poster&&video.getAttribute('poster')!==attrs.poster)video.poster=attrs.poster;
    }
    if(tag==='wx-switch'){
     let control=el.querySelector('input');if(!control){control=document.createElement('input');control.type='checkbox';control.style.cssText='width:32px;height:22px;accent-color:#c9612f';el.appendChild(control);control.onchange=()=>page.instance[node.event.change.handler]({detail:{value:control.checked}})}control.checked=Boolean(attrs.checked);
    }
    const dataset={};for(const [key,value]of Object.entries(attrs)){if(key.startsWith('data-'))dataset[key.slice(5).replace(/-([a-z])/g,(_,l)=>l.toUpperCase())]=value;}
    if(tag==='wx-button'){
     el.setAttribute('role','button');el.setAttribute('tabindex','0');el.setAttribute('aria-disabled',String(Boolean(attrs.disabled)));el.__previewTap={handler:node.event?.tap?.handler,dataset};
     if(!attached.has(el)){attached.add(el);el.addEventListener('click',()=>{if(el.getAttribute('aria-disabled')==='true')return;const current=el.__previewTap;if(current.handler&&page.instance[current.handler])page.instance[current.handler]({currentTarget:{dataset:current.dataset}})});}
    }
    if(tag==='wx-textarea'||tag==='wx-input'){
     let field=el.querySelector('input,textarea');
     if(!field){field=document.createElement(tag==='wx-textarea'?'textarea':'input');el.appendChild(field);field.oninput=()=>page.instance[node.event.input.handler]({currentTarget:{dataset},detail:{value:field.value,cursor:field.selectionStart}});field.onblur=()=>{if(node.event.blur)page.instance[node.event.blur.handler]({detail:{cursor:field.selectionStart}})};}
     field.placeholder=attrs.placeholder||'';field.setAttribute('aria-label',field.placeholder||'输入');field.disabled=Boolean(attrs.disabled);if(attrs.password)field.type='password';
     if(document.activeElement!==field)field.value=attrs.value||'';
    }
   }
  }
  for(const child of node.children||[])visit(child);
 }
 visit(page.toJSON());
}
const observer=new MutationObserver(wire);observer.observe(document.getElementById('preview'),{childList:true,subtree:true});wire();
window.addEventListener('pagehide',()=>{if(page.instance.onUnload)page.instance.onUnload();page.detach()});
`;
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>轻剪小程序 · 组件预览</title><style>${globalStyle}
html,body{position:relative;margin:0 auto;width:375px;min-height:812px;background:#fffdf9}#preview{min-height:728px}wx-view,wx-scroll-view,wx-button,wx-input,wx-textarea,wx-image,wx-progress{display:block}wx-text{display:inline}wx-button{cursor:pointer}wx-button::after{border:0}wx-button[disabled=true]{opacity:.5;cursor:default}wx-view,wx-button,wx-input,wx-textarea{box-sizing:border-box}wx-textarea textarea,wx-input input{font:inherit;color:inherit;background:transparent;border:0;outline:0;width:100%;padding:0;resize:none;box-sizing:border-box}wx-textarea textarea{height:40px}wx-textarea textarea::placeholder,wx-input input::placeholder{color:#aaa39b}.preview-note{height:28px;font:11px/28px system-ui;text-align:center;background:#f3ecd8;color:#958261}nav{display:flex;height:56px;align-items:center;justify-content:space-around;border-top:1px solid #eee5dc;position:absolute;top:756px;left:50%;width:375px;transform:translateX(-50%);background:#fffdf9;z-index:35}nav a{font:12px system-ui;color:#a07c5d;text-decoration:none}#preview .main--chat-screen{height:728px}#preview .main--screen{padding-bottom:90px}#toast{position:fixed;bottom:75px;left:20px;right:20px;text-align:center;font:13px system-ui;color:#b77455;pointer-events:none}
</style></head><body><div class="preview-note">浏览器组件预览 · 示例数据 · 未连接生产</div><main id="preview"></main><nav><a href="/preview?page=chat">创作</a><a href="/preview?page=credits">积分</a><a href="/preview?page=profile">我的</a><a href="/preview?page=settings">设置</a><a href="/preview?page=auth">登录</a></nav><div id="toast"></div><script src="/fixtures.js"></script><script src="/simulator.js"></script><script src="/runtime.js"></script></body></html>`;
const server = createServer(async (request, response) => {
  const routes = { '/fixtures.js': browserScript, '/simulator.js': sdk, '/runtime.js': runtime };
  const url = new URL(request.url, 'http://127.0.0.1');
  if(/^\/assets\/[a-zA-Z0-9_./-]+$/.test(url.pathname)&&!url.pathname.includes('..')){try{response.setHeader('Content-Type','image/png');response.end(await readFile(path.join(root,url.pathname.slice(1))));}catch{response.statusCode=404;response.end()}return;}
  const sticker=/^\/api\/sticker-packs\/qingmao-affection-v1\/items\/(\d{2})\/(thumb|preview)$/.exec(url.pathname);
  const file=sticker&&stickerSource.items.some(item=>item.id===sticker[1])?['pack',sticker[1],sticker[2]==='thumb'?'thumb.png':'animation.gif'].join('/'):
    url.pathname==='/api/templates/qingmao-stickers/sample/video'?'sample.mp4':url.pathname==='/api/templates/qingmao-stickers/sample/poster'?'poster.png':null;
  if(file){response.setHeader('Content-Type',file.endsWith('.mp4')?'video/mp4':file.endsWith('.gif')?'image/gif':'image/png');response.end(await readFile(path.join(stickerAssets,file)));return;}
  const script = routes[url.pathname]; response.setHeader('Content-Type', script ? 'application/javascript; charset=utf-8' : 'text/html; charset=utf-8'); response.setHeader('Cache-Control', 'no-store');
  response.end(script || html);
});
server.listen(Number(process.env.QINGJIAN_MINI_PREVIEW_PORT || 8797), '127.0.0.1', () => console.log('Native component visual harness: http://127.0.0.1:' + server.address().port + '/preview?page=chat'));
