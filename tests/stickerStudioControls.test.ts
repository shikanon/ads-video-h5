import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { capturePage, loadNativeApp, miniRequire, miniRoot, nativePlatform, waitFor } from './fixtures/nativeClient';

async function fixture() {
  const platform=nativePlatform('http://127.0.0.1:1','/unused'),app=await loadNativeApp(platform),calls:string[]=[];
  const project={id:'p',sessionId:'original',recipe:{mode:'static',name:'纯纯的日常心情',style:'柔彩Q版',referenceMediaId:'role'},createdAt:'2026-11-15T06:12:10Z',samples:[],previewHash:'',approved:false,ready:false};
  const job={id:'failed-samples',sessionId:'original',status:'failed',stage:'绘制贴贴静态表情',error:'样张未完成',stickerGenerationTask:{projectId:'p',phase:'samples'}};
  app.state={activeSessionId:'current',sessions:[{id:'current',messages:[]},{id:'original',messages:[]}],jobs:[job],media:[],artifacts:[]};
  app._selectedSessionId='current';app.refresh=async()=>app.state;
  let finishRetry:any,failRetry:any;const creations:any[]=[];
  app.client={hasSession:()=>true,previewUrl:()=>'',request:async(route:string,body:any)=>{
    calls.push(route);
    if(route.endsWith('/config'))return {available:true};
    if(route==='/api/sticker-projects'){if(!body)return {projects:[project]};creations.push(body);return {project:{...project,id:'new-project',recipe:body.recipe},state:{...app.state,jobs:[...app.state.jobs,{...job,id:'new-job',status:'queued',stickerGenerationTask:{projectId:'new-project',phase:'samples'}}]}};}
    if(route.endsWith('/activate'))return {activeSessionId:'original',sessions:app.state.sessions,jobs:app.state.jobs,media:[],artifacts:[]};
    if(route==='/api/jobs/failed-samples/retry')return new Promise((resolve,reject)=>{finishRetry=()=>resolve({...app.state,jobs:[{...job,status:'queued'}]});failRetry=reject;});
    throw Error('Unexpected request: '+route);
  }};
  return {platform,app,project,job,calls,creations,finishRetry:()=>finishRetry(),failRetry:(error:Error)=>failRetry(error)};
}

test('opening a failed studio task selects its original conversation before navigation, despite a pinned newer chat',async()=>{
  const f=await fixture(),page=await capturePage('sticker-studio',f.app,f.platform);page.onLoad({mode:'static'});page.onShow();await waitFor(()=>page.data.projects.length===1);page.openProject({currentTarget:{dataset:{id:'p'}}});
  await page.progress();
  assert.equal(f.app._selectedSessionId,'original');assert.equal(f.app.state.activeSessionId,'original');assert.ok(f.platform.calls.some(c=>c.kind==='switchTab'&&c.url==='/pages/chat/index'));
  assert.equal(f.calls.filter(c=>c.includes('/retry')).length,0,'viewing a task must never charge or retry it');page.onUnload();clearTimeout(f.app._cacheTimer);
});

test('compiled failed-project controls offer a real retry and a visible route back to editing, without creating another project',async()=>{
  const {JSDOM}=miniRequire('jsdom'),dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://fixture.example.test'});
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,Element:dom.window.Element,HTMLElement:dom.window.HTMLElement,Event:dom.window.Event,CustomEvent:dom.window.CustomEvent});
  const f=await fixture();let scrolls=0;f.platform.pageScrollTo=()=>{scrolls++;};Object.assign(globalThis,{wx:f.platform,getApp:()=>f.app});
  const simulate=miniRequire('miniprogram-simulate');(globalThis as any).Page=(options:any)=>{const {data,...methods}=options;(globalThis as any).Component({data,methods});};
  const id=simulate.load(path.join(miniRoot,'pages/sticker-studio/index'),{compiler:'official',rootPath:miniRoot}),page=simulate.render(id);page.attach(document.createElement('div'));page.instance.onLoad({mode:'static'});page.instance.onShow();await waitFor(()=>page.data.projects.length===1);await simulate.sleep(0);
  assert.match(page.querySelector('.project-row').dom.textContent,/样张未完成/);
  page.querySelector('.project-row').dispatchEvent('tap');await simulate.sleep(0);
  assert.equal(page.querySelector('.start-samples'),undefined,'selected project must not display a misleading second generation form');
  page.querySelector('.project-progress').dispatchEvent('tap');await simulate.sleep(0);assert.equal(f.app._selectedSessionId,'original');assert.ok(f.platform.calls.some(c=>c.kind==='switchTab'));
  assert.ok(page.querySelector('.retry-project'));assert.equal(f.calls.filter(c=>c.includes('/retry')).length,0);
  page.querySelector('.retry-project').dispatchEvent('tap');page.querySelector('.retry-project').dispatchEvent('tap');await simulate.sleep(0);
  assert.equal(f.calls.filter(c=>c.includes('/retry')).length,1);assert.equal(page.data.submitting,true);
  f.finishRetry();await simulate.sleep(0);await simulate.sleep(0);assert.equal(page.data.submitting,false);assert.equal(page.data.projectJob.active,true);assert.equal(page.querySelector('.retry-project'),undefined);
  f.app.apply({...f.app.state,jobs:[f.job]});page.instance.renderProjectJob();await simulate.sleep(0);
  page.querySelector('.edit-project').dispatchEvent('tap');await simulate.sleep(0);
  assert.equal(page.data.project,null);assert.equal(page.data.referenceId,'role');assert.equal(page.data.name,f.project.recipe.name);assert.equal(page.data.style,f.project.recipe.style);assert.equal(page.data.mode,'static');assert.ok(page.querySelector('.start-samples'));assert.equal(scrolls,1);
  assert.equal(f.creations.length,0,'viewing, retrying and editing do not submit a new project');assert.equal(f.calls.filter(c=>c.includes('/retry')).length,1);
  page.querySelector('.start-samples').dispatchEvent('tap');page.querySelector('.start-samples').dispatchEvent('tap');await simulate.sleep(0);await simulate.sleep(0);
  assert.equal(f.creations.length,1);assert.equal(f.creations[0].sessionId,'original');assert.deepEqual(JSON.parse(JSON.stringify(f.creations[0].recipe)),f.project.recipe);assert.match(f.creations[0].requestId,/^sticker_studio_/);assert.equal(page.data.project.id,'new-project');
  page.instance.onUnload();page.detach();clearTimeout(f.app._cacheTimer);dom.window.close();
});

test('a rejected retry unlocks its controls and keeps an actionable error instead of leaving the page busy',async()=>{
  const f=await fixture(),page=await capturePage('sticker-studio',f.app,f.platform);page.onLoad({mode:'static'});page.onShow();await waitFor(()=>page.data.projects.length===1);page.openProject({currentTarget:{dataset:{id:'p'}}});
  const retry=page.retry();assert.equal(page.data.submitting,true);await page.retry();assert.equal(f.calls.filter(c=>c.includes('/retry')).length,1);
  f.failRetry(Error('网络暂不可用'));await retry;assert.equal(page.data.submitting,false);assert.match(page.data.error,/网络暂不可用/);assert.equal(page.data.projectJob.retryable,true);
  assert.ok(f.platform.calls.some(c=>c.kind==='toast'&&c.title==='网络暂不可用'));
  page.regenerate();assert.equal(page.data.project,null);assert.equal(f.creations.length,0);page.onUnload();clearTimeout(f.app._cacheTimer);
});
