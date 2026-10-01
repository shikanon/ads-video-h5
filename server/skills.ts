import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export type EditingSkill = 'qingjian-audio-understanding' | 'qingjian-talking-head-edit' | 'qingjian-render-review' | 'qingjian-narrative-rebuild';
const cache = new Map<EditingSkill, Promise<string>>();
export function loadEditingSkill(name: EditingSkill): Promise<string> {
  if (!cache.has(name)) cache.set(name, readFile(fileURLToPath(new URL(`../skills/${name}/SKILL.md`, import.meta.url)), 'utf8'));
  return cache.get(name)!;
}
