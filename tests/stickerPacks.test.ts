import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { loadStickerPack, publicStickerPack, defaultStickerTask, validateStickerTask, verifyStickerAssets } from '../server/stickerPacks';
import { loadVideoTemplateCatalog, loadVideoTemplate, publicTemplate } from '../server/videoTemplates';
import { startCreditServer } from './fixtures/creditServer';
import { capturePage } from './fixtures/nativeClient';

function unzip(bytes: Buffer) {
  const files = new Map<string,Buffer>();let offset=0;
  while(bytes.readUInt32LE(offset)===0x04034b50) {
    const size=bytes.readUInt32LE(offset+18),nameLength=bytes.readUInt16LE(offset+26),extra=bytes.readUInt16LE(offset+28);
    const name=bytes.toString('utf8',offset+30,offset+30+nameLength),start=offset+30+nameLength+extra;
    files.set(name,inflateRawSync(bytes.subarray(start,start+size)));offset=start+size;
  }
  return files;
}
test('curated sticker manifest fingerprints all original files and exposes only safe sample paths', async()=>{
  const pack=await loadStickerPack(),publicPack=publicStickerPack(pack),task=defaultStickerTask(pack);
  assert.equal(publicPack.items.length,24);assert.equal(new Set(publicPack.items.map(i=>i.name)).size,24);
  assert.match(await verifyStickerAssets(pack),/^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(publicPack).includes('files'),false);
  assert.equal(JSON.stringify(publicPack).includes('D:'),false);
  for(const item of publicPack.items){assert.equal(item.durations.length,10);assert.match(item.previewUrl,/\/items\/\d{2}\/preview$/);}
  assert.deepEqual(validateStickerTask(task,pack),task);
  for(const bad of [{...task,sceneIds:['../secret',...task.sceneIds.slice(1)]},{...task,sceneIds:Array(6).fill('01')},{...task,makeVideo:'true'},{...task,title:'\n坏标题'},{...task,packId:'other'},{...task,uploadPath:'secret'},{...task,captions:Array(6).fill('太长'.repeat(20))}])assert.throws(()=>validateStickerTask(bad,pack));
  const template=(await loadVideoTemplateCatalog()).find(t=>t.id==='qingmao-stickers')!;
  assert.equal(publicTemplate(template).output,'sticker-pack');assert.ok(template.sample);
  assert.match((await loadVideoTemplate(template)).context,/同一素材清单/);
});

test('sticker form preserves edits, rejects duplicate scenes and sends the video choice once with retry idempotency',async()=>{
  const pack=publicStickerPack(await loadStickerPack()),calls:any[]=[],state:any={activeSessionId:'a',sessions:[{id:'a'}],jobs:[],artifacts:[]};
  const app:any={_generation:1,state,subscribe:()=>()=>{},refresh:async()=>state,
    client:{hasSession:()=>true,templateAssetUrl:(v:string)=>v,request:async()=>({packs:[pack]})},
    async mutate(route:string,body:any){calls.push({route,body:structuredClone(body)});throw Error('网络超时');}};
  const page=await capturePage('stickers',app,{showShareMenu(){},switchTab(){}});page.onLoad({});page.onShow();await new Promise(r=>setTimeout(r,0));
  assert.equal(page.data.items.length,24);assert.equal(page.data.scenes.length,6);
  page.title({detail:{value:'新的故事'}});page.video({detail:{value:false}});
  await page.start();await page.start();assert.equal(calls.length,2);assert.equal(calls[0].body.requestId,calls[1].body.requestId);
  assert.equal(calls[0].body.task.makeVideo,false);assert.equal(calls[0].body.task.title,'新的故事');
  page.onHide();page.onShow();await new Promise(r=>setTimeout(r,0));assert.equal(page.data.title,'新的故事');assert.equal(page.data.makeVideo,false);
  page.choose({currentTarget:{dataset:{index:0}},detail:{value:8}});await page.start();assert.equal(calls.length,2);assert.match(page.data.error,/不同动作/);
  page.onUnload();
});

test('real queue packages all 24 stickers, isolates deliveries and deduplicates requests without model calls',async t=>{
  const f=await startCreditServer();t.after(f.close);
  const cookie=await f.login(),other=await f.login('shikanon@example.test');
  assert.equal((await fetch(f.base+'/api/sticker-packs')).status,401);
  const response=await f.request(cookie,'/api/sticker-packs');const pack=(await response.json() as any).packs[0];
  assert.equal((await fetch(f.base+pack.items[0].previewUrl)).status,200);
  assert.equal((await fetch(f.base+pack.items[0].previewUrl.replace('/preview','/atlas'))).status,404);
  const initial=await (await f.request(cookie,'/api/sessions',{})).json() as any;
  const task={...defaultStickerTask(await loadStickerPack()),makeVideo:false};
  const body={sessionId:initial.activeSessionId,requestId:'fixture_sticker_request_0001',task};
  const denied=await f.request(other,'/api/sticker-packs/'+pack.id+'/jobs',body);assert.equal(denied.status,404,await denied.text());
  const send=()=>f.request(cookie,'/api/sticker-packs/'+pack.id+'/jobs',body);
  const first=await send();assert.equal(first.status,202);const queued=await first.json() as any,id=queued.stickerJobId;
  const second=await send();assert.equal(second.status,202);assert.equal((await second.json() as any).stickerJobId,id);
  assert.equal((await f.request(cookie,'/api/sticker-packs/'+pack.id+'/jobs',{...body,task:{...task,title:'参数变化'}})).status,409);
  let state:any;
  for(let i=0;i<150;i++) {
    state=await (await f.request(cookie,'/api/state')).json();const job=state.jobs.find((j:any)=>j.id===id);
    if(['succeeded','failed','cancelled'].includes(job.status)){assert.equal(job.status,'succeeded',job.error);break;}
    await new Promise(r=>setTimeout(r,200));
  }
  const artifact=state.artifacts.find((a:any)=>a.kind==='sticker-pack');assert.ok(artifact);assert.equal(state.artifacts.length,1);
  assert.equal(artifact.sticker.count,24);assert.equal(artifact.sticker.videoId,undefined);
  assert.equal((await f.request(other,artifact.downloadUrl)).status,404);
  const zip=await f.request(cookie,artifact.downloadUrl);assert.equal(zip.status,200);
  const entries=unzip(Buffer.from(await zip.arrayBuffer()));assert.equal(entries.size,101);
  assert.ok(entries.has('贴贴/动画.gif'));assert.ok(entries.has('心动/动画.webp'));assert.ok(entries.has('清单.json'));
  const source=JSON.parse(entries.get('清单.json')!.toString());assert.equal(source.sourceHash,artifact.sticker.sourceHash);
  assert.equal(f.providerState.calls,0);

  if(process.env.QINGJIAN_STICKER_RENDER_TEST==='1') {
    const videoTask={...task,title:'今天也要开心',makeVideo:true};
    const sent=await f.request(cookie,'/api/sticker-packs/'+pack.id+'/jobs',{...body,requestId:'fixture_sticker_video_0002',task:videoTask});assert.equal(sent.status,202);
    const videoJob=(await sent.json() as any).stickerJobId;
    for(let i=0;i<900;i++) {
      state=await (await f.request(cookie,'/api/state')).json();const job=state.jobs.find((j:any)=>j.id===videoJob);
      if(['succeeded','failed','cancelled'].includes(job.status)){assert.equal(job.status,'succeeded',job.error);break;}
      await new Promise(r=>setTimeout(r,400));
    }
    const video=state.artifacts.find((a:any)=>a.kind==='video');assert.ok(video);
    assert.equal(video.duration,24);assert.equal(video.hasBgm,true);assert.equal(video.name,'今天也要开心.mp4');
    assert.equal(video.sticker.sourceHash,artifact.sticker.sourceHash);
    assert.equal((await f.request(other,video.downloadUrl)).status,404);
    assert.equal((await f.request(other,video.projectUrl)).status,404);
    const project=unzip(Buffer.from(await (await f.request(cookie,video.projectUrl)).arrayBuffer()));
    for(const file of ['index.html','config.json','verification.json','music.wav','cover-portrait.png','cover-landscape.png'])assert.ok(project.has(file),file);
    assert.equal(JSON.parse(project.get('config.json')!.toString()).title,'今天也要开心');
    const evidence=JSON.parse(project.get('verification.json')!.toString());assert.equal(evidence.decodedFrames,720);assert.equal(evidence.fullDecode,true);
    if(process.env.QINGJIAN_STICKER_ARTIFACT_DIR){const target=path.resolve(process.env.QINGJIAN_STICKER_ARTIFACT_DIR);await mkdir(target,{recursive:true});for(const [file,bytes] of project)if(['scenes.jpg','cover-portrait.png','cover-landscape.png','verification.json'].includes(file))await import('node:fs/promises').then(fs=>fs.writeFile(path.join(target,file),bytes));await copyFile(path.join(f.directory,'exports',video.id+'.mp4'),path.join(target,'sticker-share-video.mp4'));}
    assert.equal(f.providerState.calls,0);
  }
});

test('saved sticker deliveries restore their story settings and changing accounts clears private form state',async()=>{
  const pack=publicStickerPack(await loadStickerPack()),task={...defaultStickerTask(await loadStickerPack()),title:'保存的故事',bgm:false};
  const state:any={activeSessionId:'a',sessions:[{id:'a'}],jobs:[],artifacts:[{id:'bundle',kind:'sticker-pack',name:'套装',sticker:{task,videoId:'video'}}]};
  const app:any={_generation:1,state,subscribe:()=>()=>{},refresh:async()=>app.state,client:{hasSession:()=>true,templateAssetUrl:(v:string)=>v,request:async()=>({packs:[pack]})}};
  const page=await capturePage('stickers',app,{showShareMenu(){}});page.onLoad({artifactId:'bundle'});page.onShow();await new Promise(r=>setTimeout(r,0));
  assert.equal(page.data.title,'保存的故事');assert.equal(page.data.bgm,false);assert.equal(page.data.result.videoId,'video');
  page.onHide();app._generation++;app.state={...state,activeSessionId:'b',artifacts:[]};page.onShow();await new Promise(r=>setTimeout(r,0));
  assert.equal(page.data.title,'被你哄好的一天');assert.equal(page.data.result,null);assert.equal(page._sessionId,'b');page.onUnload();
});

test('using the sticker template opens its form without submitting a chat message or replacing a draft',async()=>{
  const calls:any[]=[],templates=[{id:'qingmao-stickers',name:'动态表情套装',description:'',output:'sticker-pack',defaults:{seconds:24}}];
  const app:any={_generation:1,state:{activeSessionId:'one',templates},pendingAttachments:['keep'],subscribe:()=>()=>{},refresh:async()=>app.state,client:{hasSession:()=>true,request:async()=>({templates}),templateAssetUrl:()=>''}};
  const page=await capturePage('templates',app,{showShareMenu(){},navigateTo:(v:any)=>calls.push(v)});page.onShow();await new Promise(r=>setTimeout(r,0));
  page.use({currentTarget:{dataset:{id:'qingmao-stickers'}}});assert.equal(calls.length,1);assert.equal(calls[0].url,'/pages/stickers/index?sessionId=one');
  assert.deepEqual(app.pendingAttachments,['keep']);assert.equal(app.pendingTemplate,undefined);page.onHide();
});

test('a late sticker submission receipt cannot navigate away from a newer page or conversation',async()=>{
  const pack=publicStickerPack(await loadStickerPack()),calls:any[]=[],state:any={activeSessionId:'one',sessions:[{id:'one'}],jobs:[],artifacts:[]};let finish:any;
  const app:any={_generation:1,state,subscribe:()=>()=>{},refresh:async()=>state,client:{hasSession:()=>true,templateAssetUrl:(v:string)=>v,request:async()=>({packs:[pack]})},
    mutate(route:string){calls.push(route);return new Promise(resolve=>{finish=resolve})}};
  const page=await capturePage('stickers',app,{showShareMenu(){},switchTab:(o:any)=>calls.push(o.url)});page.onLoad({});page.onShow();await new Promise(r=>setTimeout(r,0));
  const pending=page.start();page.onHide();state.activeSessionId='newer';finish(state);await pending;
  assert.equal(calls.length,1);assert.match(calls[0],/\/jobs$/);assert.equal(state.activeSessionId,'newer');page.onUnload();
});
