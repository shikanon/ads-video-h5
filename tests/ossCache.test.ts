import test from 'node:test';
import assert from 'node:assert/strict';
import OSS from 'ali-oss';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createOssStorage} from '../server/ossStorage';
test('concurrent video ranges restore one private processing cache; failed restores can retry',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'oss-cache-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const env={OSS_ACCESS_KEY_ID:'fixture-access',OSS_ACCESS_KEY_SECRET:'fixture-secret',OSS_REGION:'oss-cn-guangzhou',OSS_BUCKET:'fixture-private-bucket',OSS_INTERNAL:'true'},before=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]]));Object.assign(process.env,env);t.after(()=>{for(const[k,v]of Object.entries(before))if(v===undefined)delete process.env[k];else process.env[k]=v;});
 const proto=(OSS as any).prototype,original=proto.get;let calls=0,fail=false;proto.get=async(_key:string,target:string)=>{calls++;await new Promise(r=>setTimeout(r,10));if(fail)throw Error('offline');await writeFile(target,'actual-private-video');};t.after(()=>{proto.get=original;});const storage=createOssStorage()!,file=path.join(dir,'video');
 await Promise.all(Array.from({length:12},()=>storage.ensure('owner','exports','video',file)));assert.equal(calls,1);assert.equal(await readFile(file,'utf8'),'actual-private-video');await storage.ensure('owner','exports','video',file);assert.equal(calls,1);
 const other=path.join(dir,'other');fail=true;await assert.rejects(()=>storage.ensure('owner','exports','other',other));fail=false;await storage.ensure('owner','exports','other',other);assert.equal(calls,3);
 const url=await storage.signedReadUrl('owner','exports','video');assert.match(url!,/^https:/);assert.ok(url!.includes('fixture-private-bucket'));assert.ok(url!.includes('X-Amz')||url!.includes('x-oss-')||url!.includes('Signature'));
});
