import type { LessonPresentation } from '../src/types';
import { excludesBgm } from './intents';

export function lessonPresentation(prompt:string):LessonPresentation {
  const cues=[...prompt.matchAll(/(?:紧张|迫切|紧迫|悬疑|压迫|急迫|urgent|tense|suspense)|(?:平静|舒缓|温和|轻松|calm)/gi)];
  const last=cues.at(-1);
  const negated=last&&/(?:不要|不用|避免|别|without|no)[^，。；.!?\n]{0,6}$/i.test(prompt.slice(Math.max(0,last.index!-12),last.index));
  const urgent=Boolean(last&&!negated&&/紧张|迫切|紧迫|悬疑|压迫|急迫|urgent|tense|suspense/i.test(last[0]));
  return {mood:urgent?'urgent':'neutral',bgm:urgent&&!excludesBgm(prompt)};
}
