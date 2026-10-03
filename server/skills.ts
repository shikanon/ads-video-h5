import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export type EditingSkill = 'qingjian-audio-understanding' | 'qingjian-talking-head-edit' | 'qingjian-render-review' | 'qingjian-narrative-rebuild' | 'qingjian-html-video' | 'qingjian-teaching-video' | 'qingjian-hot-video' | 'motion-design' | 'qingjian-author-avatar';
const cache = new Map<EditingSkill, Promise<string>>();
export function loadEditingSkill(name: EditingSkill): Promise<string> {
  if (!cache.has(name)) cache.set(name, readFile(fileURLToPath(new URL(`../skills/${name}/SKILL.md`, import.meta.url)), 'utf8'));
  return cache.get(name)!;
}

// Load a bounded, reviewed set of upstream references into the real authoring
// model. Relative Markdown links alone are not callable tools in Qingjian.
let motionContext: Promise<string> | undefined;
export function loadMotionDesignContext(): Promise<string> {
  return motionContext ??= Promise.all([
    loadEditingSkill('motion-design'),
    ...['director/choreography.md', 'patterns/multi-element.md', 'patterns/ambient-continuous.md'].map(file =>
      readFile(fileURLToPath(new URL(`../skills/motion-design/${file}`, import.meta.url)), 'utf8')),
    readFile(fileURLToPath(new URL('../skills/qingjian-html-video/references/components.md', import.meta.url)), 'utf8'),
  ]).then(parts => parts.join('\n\n') + '\n轻剪输出为离线视频，UI毫秒级配方需适配台词阅读时间。遵循项目DESIGN.md暖白、深墨、珊瑚、海岸蓝。主信息先入场，连线承接关系，重点后强调，背景低幅度运动；不得无限循环、运行时随机、异步建时间轴或添加未经证实的数据。');
}
