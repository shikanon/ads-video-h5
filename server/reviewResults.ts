import type { LessonReport } from '../src/types';

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

export function reviewNeedsContentRepair(review:{status:string;checks:Array<{name:string;passed:boolean}>;semantic?:{score:number;findings:string[]}}):boolean {
  if(review.status==='passed')return false;
  const incomplete=new Set(['成片语义审查','声音审听完成度','声音实测完成度']);
  return Boolean(review.semantic&&(review.semantic.score<80||review.semantic.findings.length))||review.checks.some(c=>!c.passed&&(!incomplete.has(c.name)||c.name==='成片语义审查'&&Boolean(review.semantic)));
}

export function newsFreshAtReview(report:LessonReport,now=Date.now()):boolean {
  const news=report.hotResearch;if(!news)return false;
  const asOf=Date.parse(news.asOf),window=news.windowHours*3600000;
  // The 30-minute cache controls research reuse during creation. Reviewing an
  // existing dated film must instead verify publication dates in its news window.
  return Number.isFinite(asOf)&&window>0&&asOf<=now+300000&&now-asOf<=window&&report.references.some(ref=>{
    const published=Date.parse(ref.publishedAt||'');
    return ref.verification==='news-page'&&ref.freshness==='fresh'&&Number.isFinite(published)&&published<=now+300000&&now-published<=window;
  });
}
