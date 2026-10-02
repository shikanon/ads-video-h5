import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { researchGaps } from './narrativeResearch';
import { primaryLessonUrl } from './lessonResearch';

type Research=Awaited<ReturnType<typeof researchGaps>>;
const maxAge=24*60*60*1000;

// The fingerprint includes the owner, exact request and export mode. Reuse
// evidence only; the script, speech, scenes and review are newly produced.
export async function cachedLessonResearch(dataDir:string,fingerprint:string,exclude:string,now=Date.now()):Promise<{research:Research;sourceWorkflowId:string;retrievedAt:string}|undefined>{
  if(!/^[a-f0-9]{64}$/.test(fingerprint))return;
  const root=path.join(dataDir,'lesson-workflows');let entries;
  try{entries=await readdir(root,{withFileTypes:true});}catch{return;}
  const candidates=await Promise.all(entries.filter(e=>e.isDirectory()&&e.name!==exclude&&/^[\w-]{1,80}$/.test(e.name)).map(async e=>{
    try{const file=path.join(root,e.name,'checkpoint.json'),s=await stat(file);return s.size<=1000000?{id:e.name,file,mtime:s.mtimeMs}:undefined;}catch{return;}
  }));
  for(const candidate of candidates.filter((v):v is NonNullable<typeof v>=>Boolean(v)).sort((a,b)=>b.mtime-a.mtime).slice(0,100)){
    try{
      const checkpoint=JSON.parse(await readFile(candidate.file,'utf8'));if(checkpoint.fingerprint!==fingerprint)continue;
      const r=checkpoint.research as Research;if(typeof r?.summary!=='string'||!Array.isArray(r.references)||r.references.length<3||!Array.isArray(r.queries))continue;
      if(r.current)continue; // A stable academic cache cannot stand in for fresh news.
      if(r.references.some(ref=>!primaryLessonUrl(ref.url)||!ref.excerpt||!Number.isFinite(Date.parse(ref.retrievedAt||''))||now-Date.parse(ref.retrievedAt!)>maxAge||Date.parse(ref.retrievedAt!)>now+60000))continue;
      if(r.references.filter(ref=>['primary-page','primary-paper','primary-record'].includes(ref.verification)).length<3)continue;
      const retrievedAt=new Date(Math.min(...r.references.map(ref=>Date.parse(ref.retrievedAt!)))).toISOString();
      return {research:structuredClone(r),sourceWorkflowId:candidate.id,retrievedAt};
    }catch{/* Incomplete or malformed checkpoints cannot become evidence. */}
  }
}
