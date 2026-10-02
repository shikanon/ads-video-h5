// Providers sometimes return richer issue objects despite the string-array
// example. Preserve the concrete correction without relaxing pass criteria.
export function reviewFindings(value:unknown):string[]{
  if(!Array.isArray(value))throw new Error('审查问题须为数组。');
  return value.map(v=>{
    if(typeof v==='string')return v;
    if(!v||typeof v!=='object'||Array.isArray(v))throw new Error('审查问题缺少可读的修正要求。');
    const item=v as Record<string,unknown>;
    const issue=item.finding||item.issue||item.problem||item.error||item.message||item.detail||item.requirement||item.description||item.content||item.text||item.suggestion;
    const repair=item.repair||item.fix||(item.finding||item.issue||item.problem?item.requirement:undefined)||(item.suggestion!==issue?item.suggestion:undefined);
    if(typeof issue!=='string'||!issue.trim()||repair!==undefined&&typeof repair!=='string')throw new Error('审查问题缺少可读的修正要求。');
    const id=item.chapterId||item.chapter||item.id;
    const evidence=typeof item.evidence==='string'?item.evidence.trim():'';
    return `${typeof id==='string'?id+'：':''}${issue}${evidence?' 依据：'+evidence:''}${repair?' 修正：'+repair:''}`;
  });
}

export function validateSemanticReview(value:any):{score:number;needsRepair:boolean;findings:string[];suggestions:string[]}{
  if(!Number.isFinite(value?.score)||value.score<0||value.score>100||typeof value.needsRepair!=='boolean')throw new Error('审查输出格式无效');
  const findings=reviewFindings(value.findings),suggestions=reviewFindings(value.suggestions??[]);
  return {score:value.score,needsRepair:value.needsRepair||findings.length>0||value.score<80,findings,suggestions};
}
