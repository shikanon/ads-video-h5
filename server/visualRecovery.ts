import type { LessonReport, RenderReview } from '../src/types';

// A renderer limitation can be solved without rewriting verified narration.
// Ambiguous factual, text or audio findings still use the script/audio repair.
export function visualRepairTargets(report:LessonReport,review:RenderReview):string[]{
  if(report.factReview?.needsRepair||!report.factReview)return [];
  const failed=review.checks.filter(check=>!check.passed);
  if(!failed.length||failed.some(check=>check.name!=='成片语义审查'))return [];
  const findings=review.semantic?.findings||[];
  if(!findings.length||findings.some(text=>/事实错误|数据错误|公式错误|旁白错误|字幕|音色|音量|错读|图解说明不准确/.test(text)))return [];
  if(!findings.every(text=>/图标|配图|没有.*(?:图|画)|未呈现|缺乏.*图解|缺少.*(?:示意|图解)|未.*(?:画出|展示)|静态卡片|任务清单|图解仅复现文字|无法.*直观|画面.*(?:错误|缺失)|动画/.test(text)))return [];
  const matched=report.chapters.filter(chapter=>findings.some(text=>text.includes(chapter.id))).map(chapter=>chapter.id);
  return matched.length&&!findings.some(text=>/全局|global|所有|全程/.test(text))?matched:report.chapters.map(chapter=>chapter.id);
}

export function speechOnlyRepair(review:RenderReview):boolean{
  const findings=review.semantic?.findings||[];
  if(!findings.length)return false;
  if(review.checks.some(c=>!c.passed&&!/成片语义审查|声音|音色|响度|人声|旁白|停顿|音量/.test(c.name)))return false;
  return findings.every(f=>/字幕|旁白|错读|漏字|遗漏|缺字|少字|没读|未读|音色|响度|音量|声音/.test(f)&&!/事实错误|公式错误|数据错误|画面|配图|制作备注|内部说明/.test(f));
}
