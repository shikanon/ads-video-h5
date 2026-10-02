import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { motionLibrary } from '../server/motionComponents';
import { createEffectStore } from '../server/htmlEffects';
import { loadMotionDesignContext } from '../server/skills';
import { drawingHtml, validateDrawing } from '../server/narrativeScenes';

const {gsap}=createRequire(import.meta.url)('gsap');
test('motion components use finite deterministic timelines and render identically after backward seeking',()=>{
  const window:any={};runInNewContext(motionLibrary,{window,gsap});
  const tl=gsap.timeline({paused:true});
  const ambient={y:0},focus={scale:1},bar={scaleY:1,transformOrigin:''},line={opacity:1,strokeDasharray:0,strokeDashoffset:0,getTotalLength:()=>123};
  const particles=Array.from({length:8},()=>({x:0,y:0,scale:1,opacity:0}));
  window.QJMotion.ambientFloat(tl,ambient,.2,4,8);
  window.QJMotion.focusPulse(tl,focus,1,.6);window.QJMotion.barGrow(tl,bar,.4,.8);
  window.QJMotion.connectorFlow(tl,line,.5,.7);window.QJMotion.radialBurst(tl,particles,1.6,36);
  assert.equal(tl.duration(),4.2);assert.ok(tl.getChildren().every((t:any)=>t.repeat()===0));
  const snapshot=()=>[ambient.y,focus.scale,bar.scaleY,line.strokeDashoffset,...particles.flatMap(p=>[p.x,p.y,p.scale,p.opacity])];
  tl.seek(1.85);const expected=snapshot();tl.seek(0);tl.seek(1.85);assert.deepEqual(snapshot(),expected);
  tl.seek(4.2);assert.equal(focus.scale,1);assert.equal(line.strokeDashoffset,0);assert.ok(particles.every(p=>p.opacity===0));tl.kill();
});
test('motion catalog upgrades preserve administrator edits and later deletions',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'qj-motion-'));
  try {
    const first=createEffectStore(root);await first.init();assert.equal(first.list().length,9);
    const effect=first.get('cause-chain')!;await first.upsert({...effect,name:'管理员因果',enabled:false},effect.id);await first.remove('sop-flow');
    const second=createEffectStore(root);await second.init();assert.equal(second.get('cause-chain')?.name,'管理员因果');assert.equal(second.get('cause-chain')?.enabled,false);assert.equal(second.get('sop-flow'),undefined);
  } finally {await rm(root,{recursive:true,force:true});}
});
test('real model context includes upstream motion rules and native component recipes',async()=>{
  const context=await loadMotionDesignContext();assert.ok(context.includes('Motion Design Skill'));assert.ok(context.includes('Counter-Motion'));assert.ok(context.includes('ambientFloat'));assert.ok(context.includes('离线视频'));
});
test('drawing compilation supports motion personality, rejects unknown motion code and keeps old layouts valid',()=>{
  const nodes=Array.from({length:3},(_,i)=>({id:`node${i}`,kind:'card' as const,x:60,y:240+i*180,w:600,h:140,text:'需求',tone:'paper' as const,fontSize:40,highlight:true}));
  const html=drawingHtml({title:'测试',motion:'premium',nodes},4);
  assert.ok(html.includes("QJMotion.cardSettle"));assert.ok(html.includes("QJMotion.focusPulse"));assert.ok(html.includes("QJMotion.ambientFloat"));assert.ok(html.includes("'sine.out'"));
  assert.doesNotThrow(()=>validateDrawing({title:'旧版',nodes}));assert.throws(()=>validateDrawing({title:'攻击',motion:'alert(1)' as any,nodes}),/动效风格/);
});
