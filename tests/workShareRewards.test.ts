import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createCredits} from '../server/credits';
import {createWorkShareRewards} from '../server/workShareRewards';
import {defaultTokenPrices} from '../server/tokenPricing';
import type {Job,Artifact} from '../shared/types';

test('voluntary work rewards need two real distinct WeChat productions; ledger settlement is concurrent and restart safe',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'work-reward-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 let now=Date.parse('2026-11-21T08:00:00Z'),revoked=false;const credits=createCredits(dir,{now:()=>now});await credits.load();
 await credits.recordUsage('owner','paid-work',defaultTokenPrices()[0].modelId,'paid-request',{input:1000,output:100,cachedInput:0,audioInput:0,cachedAudioInput:0},defaultTokenPrices()[0]);
 const before=await credits.snapshot('owner'),state:{jobs:Job[];artifacts:Artifact[]}={jobs:[],artifacts:[]};
 const identity=(id:string)=>id==='email'?undefined:{appId:'app',openId:id==='alias'?'one':id};
 const options={dataDir:dir,credits,identity,state:()=>state,now:()=>now,resolve:async()=>{if(revoked)throw Error('revoked');return {ownerId:'owner',key:'video:work',complete:true,taskIds:['paid-work']};}};
 const rewards=createWorkShareRewards(options);await rewards.load();
 await Promise.all(['owner','one','alias','email','two'].map(id=>rewards.attribute(id,'video','token')));
 await rewards.settle();assert.equal((await credits.snapshot('owner')).balance,before.balance,'opening and clicking make-my-own do not grant');
 function produce(id:string,overrides:Partial<Job>={}){now+=1000;const at=new Date(now).toISOString();state.jobs.push({id:'j-'+id,ownerId:id,sessionId:'s-'+id,messageId:'m-'+id,kind:'export',interaction:'create',status:'succeeded',createdAt:at,updatedAt:at,creditTaskId:'task-'+id,artifactId:'a-'+id,...overrides});state.artifacts.push({id:'a-'+id,ownerId:id,sessionId:'s-'+id,messageId:'m-'+id,kind:'video',createdAt:at,name:'real output',url:'/',downloadUrl:'/',version:1});}
 produce('one');await rewards.settle();assert.equal((await credits.snapshot('owner')).balance,before.balance,'one friend is insufficient');
 produce('two',{creditTaskId:undefined});await rewards.settle();assert.equal((await credits.snapshot('owner')).balance,before.balance,'operator imports and copied output are not production');
 state.jobs[state.jobs.length-1].creditTaskId='actual-production';await Promise.all(Array.from({length:12},()=>rewards.settle()));
 const history=await credits.history('owner'),gifts=history.entries.filter(e=>e.kind==='share_reward');assert.equal(gifts.length,1);assert.equal(gifts[0].points,before.totalSpent);assert.equal(history.wallet.totalSpent,before.totalSpent,'a gift is not a refund');
 const restarted=createWorkShareRewards(options);await restarted.load();await restarted.settle();assert.equal((await credits.history('owner')).entries.filter(e=>e.kind==='share_reward').length,1);
 const registry=JSON.parse(await readFile(path.join(dir,'work-share-rewards.json'),'utf8'));assert.equal(new Set(registry.rows.filter((r:any)=>r.jobId).map((r:any)=>r.identity)).size,2);assert.ok(!registry.rows.some((r:any)=>['owner','email','alias'].includes(r.viewerId)));
 revoked=true;await assert.rejects(()=>rewards.attribute('three','video','token'));
});

test('reward is limited to net actual image debits, excludes pending usage, and never increases total spent',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'work-cost-'));t.after(()=>rm(dir,{recursive:true,force:true}));const c=createCredits(dir);await c.load();
 const p=await c.imagePricing('doubao-seedream-5-0-flash-260915');for(const id of ['one','two']){const task=await c.admitImages('o',p.price.modelId,[id],p.pricingHash);await c.recordImageUsage('o',task,p.price.modelId,id);await c.releaseImages(task);if(id==='two')await c.refundImageTask('o',task,'service failure');}
 const h=await c.history('o'),tasks=h.entries.map(e=>e.taskId).filter((x):x is string=>Boolean(x));const spend=await c.workSpend('o',tasks);assert.equal(spend,120*1e6);
 assert.equal(await c.rewardWork('o','sticker:p',tasks,1000*1e6),120);assert.equal(await c.rewardWork('o','sticker:p',tasks,1000*1e6),0);assert.equal((await c.snapshot('o')).totalSpent,120);
 assert.equal(await c.rewardWork('o','video:free',[],1000*1e6),0);assert.equal(await c.workSpend('someone-else',tasks),0);
});
