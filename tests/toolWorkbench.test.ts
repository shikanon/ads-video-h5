import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {capturePage} from './fixtures/nativeClient';
const require=createRequire(import.meta.url),{projectLinks}=require('../apps/miniprogram/miniprogram/utils/project-links.js');
const e=(id:string)=>({currentTarget:{dataset:{id}}});
function fixture(){
 const calls:any[]=[],listeners=new Set<()=>void>(),storage=new Map(),state:any={account:{id:'a'},activeSessionId:'old',sessions:[{id:'old',title:'原对话',messages:[]}],jobs:[],media:[{id:'m',kind:'image',name:'角色图',url:'/api/media/m',mimeType:'image/png'}],artifacts:[],models:[],settings:{}};
 const app:any={state,_generation:1,user:{id:'a'},subscribe:(f:()=>void)=>{listeners.add(f);return()=>listeners.delete(f);},refresh:async()=>state,client:{hasSession:()=>true,previewUrl:()=>'',mediaUrl:(s:string)=>s,download:async()=>'/local/private.png',request:async(route:string)=>{calls.push({route});if(route.includes('/config'))return {available:true};if(route==='/api/sticker-projects')return {projects:[]};if(route.startsWith('/api/templates'))return {templates:[{id:'video-style-interface',name:'界面动效',output:'video',tool:{category:'video',group:'interface',prompt:'@界面动效 产品：【填写】',thumbnailUrl:'/original/poster'}}]};throw Error('unexpected '+route);}}};
 app.mutate=async(route:string,body:any,method:string)=>{calls.push({route,body,method});if(route==='/api/sessions'){state.sessions.unshift({id:'canvas',title:'新会话',mode:'work',messages:[]});state.activeSessionId='canvas';}else if(route.endsWith('/workspace'))state.sessions.find(s=>route.includes('/'+s.id+'/')).toolWorkspace=structuredClone(body);else if(route==='/api/chat'){state.jobs.push({id:'job',sessionId:body.sessionId,status:'queued'});}for(const f of listeners)f();return state;};
 const wx:any={getWindowInfo:()=>({windowHeight:680}),getStorageSync:(k:string)=>storage.get(k),setStorageSync:(k:string,v:any)=>storage.set(k,structuredClone(v)),showToast:(v:any)=>calls.push(v),showShareMenu(){},navigateTo:(v:any)=>calls.push(v),switchTab:(v:any)=>calls.push(v)};
 return {app,wx,state,calls};
}
test('tool input creates a persistent workspace only on upload/send, preserves canvas layout and restores the same project',async()=>{
 const f=fixture(),page=await capturePage('templates',f.app,f.wx);page.onLoad();page.onShow();await page.load();await page.category(e('video'));
 page.chooseTemplate(e('video-style-interface'));assert.equal(page.data.prompt,'@界面动效 产品：【填写】');assert.equal(f.state.sessions.length,1);assert.equal(f.state.jobs.length,0);
 page.setData({attachmentIds:['m']});await page.ensureWorkspace();page.render(f.state);assert.equal(page.data.nodes[0].sourceId,'m');
 page.layout({...page._worldNodes.find(n=>n.id==='media-m'),x:87,y:42});await page.persist();assert.equal(f.state.sessions[0].toolWorkspace.nodes[0].x,87);
 page.onHide();const returned=await capturePage('templates',f.app,f.wx);returned.onLoad();returned.onShow();await returned.load();assert.equal(returned.data.sessionId,'canvas');assert.equal(returned.data.nodes[0].x,87);assert.equal(returned.data.prompt,'@界面动效 产品：【填写】');
 await returned.send();assert.equal(f.state.jobs.length,1);assert.equal(f.calls.filter(c=>c.route==='/api/chat').length,1);assert.equal(returned.data.prompt,'');
 returned.chat();assert.ok(f.calls.some(c=>c.url==='/pages/chat/index'));returned.onHide();
});
test('new empty projects do not reopen the old project and pending return links win over stored drafts',async()=>{
 const f=fixture(),page=await capturePage('templates',f.app,f.wx);page.onLoad();page.onShow();await page.load();await page.ensureWorkspace();await page.newProject();page.render(f.state);assert.equal(page.data.sessionId,'');assert.equal(page.data.nodes.length,0);
 page.onHide();f.app.pendingToolWorkspace={sessionId:'canvas',category:'stickers'};page.onShow();assert.equal(page.data.sessionId,'canvas');page.onHide();
});

test('a folder opens the video MV technique on the shared canvas and still requires explicit user audio',async()=>{
 const f=fixture();f.state.mediaFolders=[{id:'folder',name:'我的素材',mv:{audioId:'previous-song'}}];f.state.media.push({id:'previous-song',kind:'audio',name:'旧配乐',duration:60});f.state.artifacts.push({id:'old-film',sessionId:'old',name:'已有视频',kind:'video',url:'/old'});const n={id:'artifact-old-film',sourceId:'old-film',sourceKind:'artifact',x:-500000,y:600000,width:128,height:168};f.state.toolCanvases={video:{version:1,nodes:[n],camera:{x:-500020,y:599980,zoom:1},updatedAt:'2026-11-21'}};f.app.pendingMvFolder='folder';
 const page=await capturePage('templates',f.app,f.wx);page.onLoad();page.onShow();await page.load();assert.equal(page.data.category,'video');assert.equal(page.data.templateId,'narrative-montage');assert.equal(page.data.mvSettings.folderId,'folder');assert.equal(page.data.mvSettings.audioId,'','folder defaults are not permission to choose audio');assert.equal(page.data.nodeCount,1);assert.equal(page.data.nodes[0].x,-500000);assert.equal(page.data.mvActive,true);assert.ok(page.data.cards.some(c=>c.id==='narrative-montage'));page.onHide();
});
test('editing while a save is in flight keeps the newest draft instead of clearing its dirty flag',async()=>{
 const f=fixture(),page=await capturePage('templates',f.app,f.wx);page.onLoad();page.onShow();await page.load();await page.ensureWorkspace();let finish:any;const original=f.app.mutate;let first=true;
 f.app.mutate=async(...args:any[])=>{if(first){first=false;await new Promise(r=>{finish=r;});}return original(...args);};
 page.input({detail:{value:'旧草稿'}});const saving=page.persist();page.input({detail:{value:'新草稿'}});finish();await saving;assert.equal(f.state.sessions[0].toolWorkspace.draft,'新草稿');page.onHide();
});
test('result links recover artifacts by their original job and do not depend on a missing assistant artifact list',()=>{
 const state:any={sessions:[{id:'s',toolWorkspace:{category:'stickers'}}],artifacts:[{id:'result',kind:'image',sessionId:'s',messageId:'user'}]},job={id:'j',messageId:'user',sessionId:'s',status:'succeeded',artifactId:'result',stickerGenerationTask:{projectId:'p'}};
 const links=projectLinks({id:'assistant'},job,state);assert.deepEqual(links.map(l=>l.kind),['sticker','artifact','workspace']);assert.equal(links.filter(l=>l.id==='result').length,1);
});
test('all 24 results remain reachable on the virtual canvas, and hidden nodes can be restored after an immediate undo is gone',async()=>{
 const f=fixture(),page=await capturePage('templates',f.app,f.wx);page.onLoad();page.onShow();await page.load();await page.ensureWorkspace();
 f.state.artifacts=Array.from({length:24},(_,i)=>({id:'a'+i,sessionId:'canvas',kind:'image',name:'动作'+i,url:'/private/'+i,createdAt:'2026-11-18'}));page.render(f.state);assert.equal(page.data.nodeCount,24);assert.ok(page._worldNodes[23].y>2000);assert.ok(page.data.nodes.length<24);page.focusNode(e('artifact-a0'));assert.ok(page.data.nodes.some(n=>n.id==='artifact-a0'));page.focusNode(e('artifact-a23'));assert.ok(page.data.nodes.some(n=>n.id==='artifact-a23'));
 const n=page.data.nodes[0];page.layout({...n,hidden:true});page.render(f.state);assert.equal(page.data.nodeCount,23);page._undo=null;page.showAll();assert.equal(page.data.nodeCount,24);await page.persist();page.onHide();
});
test('only the tools tab layout changes; static original examples replace public video playback',async()=>{
 const app=JSON.parse(await readFile('apps/miniprogram/miniprogram/app.json','utf8'));assert.deepEqual(app.tabBar.list.map(t=>t.pagePath),['pages/chat/index','pages/templates/index','pages/library/index','pages/profile/index']);
 const wxml=await readFile('apps/miniprogram/miniprogram/pages/templates/index.wxml','utf8');assert.doesNotMatch(wxml,/<video\b|暂无例图|先选模板，再添加素材/);assert.match(wxml,/catchtouchstart="boardStart"/);assert.match(wxml,/catchtouchmove="nodeMove"/);assert.doesNotMatch(wxml,/<movable-area/);assert.match(wxml,/catchtap="nodeMenu"/);
});

test('original template thumbnails and private style previews use the configured API subpath, including the older catalog contract',async()=>{
 const {createClient}=require('../apps/miniprogram/miniprogram/utils/api.js'),{cards}=require('../apps/miniprogram/miniprogram/utils/tool-workbench.js');const cookie='qingjian_session='+'a'.repeat(40),base='https://example.test/qingjian/api',downloads:any[]=[];
 const platform={getStorageSync:(key:string)=>key==='qingjian:wechat-session:v1:'+base?cookie:undefined,removeStorageSync(){},setStorageSync(){},downloadFile(o:any){downloads.push(o);o.success({statusCode:200,tempFilePath:'/local/image.png'});}};
 const client=createClient(platform,{apiBase:base,publicMediaOrigins:[]});
 assert.equal(client.mediaUrl('/api/sticker-projects/p/styles/soft'),base+'/sticker-projects/p/styles/soft');assert.equal(client.mediaUrl('/qingjian/api/media/m'),base+'/media/m');
 assert.equal(client.templateAssetUrl('/api/sticker-styles/lightmao'),base+'/sticker-styles/lightmao');assert.equal(client.templateAssetUrl('/api/artifacts/private'),'');
 const catalog=cards([{id:'qingmao-stickers',name:'动态表情套装',output:'sticker-pack'},{id:'video-style-interface',name:'界面动效'}],client);assert.equal(catalog[0].thumbnail,'/assets/templates/qingmao-stickers.png');assert.equal(catalog[1].thumbnail,'/assets/templates/video-style-interface.png');
 await client.download('/api/sticker-projects/p/styles/soft');assert.equal(downloads[0].url,base+'/sticker-projects/p/styles/soft');assert.equal(downloads[0].header.Cookie,cookie);
});

test('fitting the canvas resets its viewport without rearranging a user’s saved nodes',async()=>{
 const f=fixture(),page=await capturePage('templates',f.app,f.wx);page.onLoad();page.onShow();await page.load();page._layouts=[{id:'m',sourceId:'m',sourceKind:'media',x:87,y:42,width:112,height:158}];const before=JSON.stringify(page._layouts);page.zoom({currentTarget:{dataset:{delta:'0.1'}}});assert.equal(page.data.zoomPercent,110);page.fit();assert.equal(page.data.zoomPercent,100);assert.equal(JSON.stringify(page._layouts),before);page.onHide();
});

test('bundled examples are byte-for-byte copies of the original curated assets',async()=>{
 const {createHash}=require('node:crypto'),sources=JSON.parse(await readFile('apps/miniprogram/miniprogram/assets/templates/sources.json','utf8'));assert.equal(sources.length,5);
 for(const source of sources){const original=await readFile(source.source),bundled=await readFile('apps/miniprogram/miniprogram/'+source.target);assert.deepEqual(bundled,original);assert.equal(createHash('sha256').update(bundled).digest('hex'),source.sha256);assert.doesNotMatch(source.source,/diagnostics|candidate-soft|candidate-round/);}
});
