import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,readFile,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createCredits } from '../server/credits';
import { defaultImagePrices } from '../server/imagePricing';
import { withCreditUsage,assertImageBudget,recordImageUsage } from '../server/creditUsage';
const model=defaultImagePrices()[0].modelId;
const user={id:'ordinary',email:'ordinary@example.test',displayName:'普通账号'};
async function fixture(t:any){const dir=await mkdtemp(path.join(tmpdir(),'image-credits-'));t.after(()=>rm(dir,{recursive:true,force:true}));const credits=createCredits(dir);await credits.load([user]);const price=await credits.imagePricing(model);return {dir,credits,price};}

test('image phase admission requires a current price and enough own available points, without sharing conditions',async t=>{
 const {credits,price}=await fixture(t);assert.equal(price.pointsPerImage,120);
 await assert.rejects(()=>credits.imagePricing('unconfigured'),/尚未配置/);
 for(const hash of ['', 'stale'])await assert.rejects(()=>credits.admitImages(user.id,model,['one'],hash),/价格已更新/);
 const attempts=await Promise.allSettled([credits.admitImages(user.id,model,Array.from({length:10},(_,i)=>'a'+i),price.pricingHash),credits.admitImages(user.id,model,Array.from({length:10},(_,i)=>'b'+i),price.pricingHash)]);
 assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);assert.equal(attempts.filter(r=>r.status==='rejected').length,1);
 const task=(attempts.find(r=>r.status==='fulfilled') as PromiseFulfilledResult<string>).value;
 assert.equal((await credits.snapshot(user.id)).balance,800);assert.equal((await credits.snapshot(user.id)).reserved,1200);assert.equal((await credits.snapshot(user.id)).totalSpent,0);
 await assert.rejects(()=>credits.admitImages(user.id,model,['a0'],price.pricingHash),/制作中/);
 await credits.releaseImages(task);assert.equal((await credits.snapshot(user.id)).balance,2000);
});

test('actual images settle once at the frozen price; unused reservations release after failure or restart',async t=>{
 const {credits,dir,price}=await fixture(t),task=await credits.admitImages(user.id,model,['one','two','three'],price.pricingHash);
 await credits.setImagePrice({modelId:model,rmbPerImage:.2});
 await withCreditUsage(credits,user.id,task,async()=>{await assertImageBudget(model,'one');await recordImageUsage(model,'one');await recordImageUsage(model,'one');await assert.rejects(()=>assertImageBudget(model,'one'),/额度已失效/);await assert.rejects(()=>assertImageBudget('changed','two'),/额度已失效/);});
 assert.equal((await credits.snapshot(user.id)).totalSpent,120);assert.equal((await credits.snapshot(user.id)).balance,1640);
 const restarted=createCredits(dir);await restarted.load([user]);assert.equal((await restarted.snapshot(user.id)).reserved,240);
 await restarted.releaseInactiveImages([]);assert.equal((await restarted.snapshot(user.id)).balance,1880);assert.equal((await restarted.snapshot(user.id)).reserved,undefined);
 const ledger=await restarted.history(user.id),charge=ledger.entries.find(e=>e.imageCount);assert.equal(charge?.points,-120);assert.equal(charge?.imagePrice?.rmbPerImage,.12);assert.equal(ledger.entries.filter(e=>e.imageCount).length,1);
 assert.deepEqual(await restarted.imageQuote(user.id,model,['one','two']),{pricingHash:(await restarted.imagePricing(model)).pricingHash,imageCount:1,points:200,pointsPerImage:200});
 await assert.rejects(()=>restarted.admitImages(user.id,model,['two'],price.pricingHash),/价格已更新/);
});

test('legacy pending receipts and existing balances are preserved without retroactive image charges',async t=>{
 const {credits,dir}=await fixture(t);
 await credits.recordUsage(user.id,'legacy',model,'old-image',undefined,{modelId:model,input:0,cachedInput:0,output:0,source:'per-image pricing pending',updatedAt:'old'});
 const old=JSON.parse(await readFile(path.join(dir,'credits.json'),'utf8'));delete old.imagePrices;delete old.imageReservations;await writeFile(path.join(dir,'credits.json'),JSON.stringify(old));
 const restarted=createCredits(dir);await restarted.load([user]);const p=await restarted.imagePricing(model);
 const task=await restarted.admitImages(user.id,model,['old-image'],p.pricingHash);assert.equal(await restarted.recordImageUsage(user.id,task,model,'old-image'),0);await restarted.releaseImages(task);
 const history=await restarted.history(user.id);assert.equal(history.wallet.balance,2000);assert.equal(history.wallet.totalSpent,0);assert.equal(history.entries[0].kind,'usage_pending');
 assert.deepEqual(JSON.parse(await readFile(path.join(dir,'credits.json'),'utf8')).entries,old.entries);
 await assert.rejects(()=>restarted.recordImageUsage(user.id,'no-admission',model,'new-image'),/额度/);
});
