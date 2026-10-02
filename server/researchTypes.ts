import type { HotResearchBrief, ResearchReference } from '../src/types';

export interface ResearchResult {
  summary: string;
  references: ResearchReference[];
  usage?: unknown;
  queries: unknown[];
  current?: HotResearchBrief;
}
