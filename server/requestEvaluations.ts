import { createHash } from 'node:crypto';
import type { Format, LessonReport, WorkflowEvent } from '../src/types';
import type { CreationContext, CreationRoute, CreativeRequest } from './creativeRequest';
import { classify, intentText } from './intents';
import { lessonSettings } from './lessonSpec';
import { lessonPresentation } from './lessonPresentation';
import { executionDiagnostics } from './toolTrace';

export interface RequestEvaluationCase {
  id:string;family:string;prompt:string;context?:LessonReport;
  expected:{mode:CreativeRequest['mode'];export:boolean;topic?:string;topicAliases?:string[];seconds?:number;format?:Format;mood?:'urgent'|'neutral';bgm?:boolean};
}
export function requestCaseHash(c:RequestEvaluationCase) {
  return createHash('sha256').update(JSON.stringify({prompt:c.prompt,context:c.context,expected:c.expected})).digest('hex');
}
export function requestEvaluationContext(c:RequestEvaluationCase):CreationContext {
  return {prompt:c.prompt,sourceCount:0,hasPlan:Boolean(c.context),lesson:c.context,kind:classify(c.prompt),history:c.context?[{id:'previous',role:'user',text:`制作${c.context.hotResearch?'新闻资讯':'知识图解'}视频，主题${c.context.title}，${c.context.requestedSeconds}秒，${c.context.format}`,createdAt:''}]:[]};
}
export function checkRequestContract(c:RequestEvaluationCase,route:CreationRoute|CreativeRequest,events:WorkflowEvent[]) {
  const prompt='lessonPrompt' in route&&route.lessonPrompt||c.prompt;
  // Footage edits can legitimately be shorter than a topic explainer's 15s
  // minimum. Only apply lesson settings when that production path is tested.
  const settings=['news','explainer'].includes(route.mode)||c.expected.seconds!==undefined||c.expected.format!==undefined?lessonSettings(prompt):null;
  const presentation=lessonPresentation(prompt);
  const checks:Array<{name:string;passed:boolean;expected:unknown;actual:unknown}>=[];
  const add=(name:string,expected:unknown,actual:unknown)=>checks.push({name,passed:expected===actual,expected,actual});
  add('mode',c.expected.mode,route.mode);add('export',c.expected.export,route.export);
  if('requiresFootage'in route)add('requiresFootage',c.expected.mode==='footage',route.requiresFootage);
  if(c.expected.topic){const normalize=(s:string)=>intentText(s).replace(/\s/g,'').toLowerCase();add('topic-preserved',true,[c.expected.topic,...(c.expected.topicAliases||[])].some(topic=>normalize(route.topic||prompt).includes(normalize(topic))));}
  if(c.expected.seconds!==undefined)add('duration',c.expected.seconds,settings?.requestedSeconds);
  if(c.expected.format!==undefined)add('format',c.expected.format,settings?.format);
  if(c.expected.mood!==undefined)add('mood',c.expected.mood,presentation.mood);
  if(c.expected.bgm!==undefined)add('bgm',c.expected.bgm,presentation.bgm);
  return {passed:checks.every(c=>c.passed),checks,settings,presentation,diagnostics:executionDiagnostics(events)};
}
