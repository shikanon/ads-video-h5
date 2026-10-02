import type { EvaluationCase, EvaluationCategory, EvaluationExpectation } from '../src/evaluationTypes';

export const EVALUATION_RUBRIC_VERSION = 'qingjian-video-v2';
export const evaluationCategoryNames: Record<EvaluationCategory, string> = { 'hot-news': '热点新闻', knowledge: '知识科普', 'multi-video': '多素材剪辑' };
const expected = (seconds: number, format: EvaluationExpectation['format'], extra: Partial<EvaluationExpectation> = {}): EvaluationExpectation => ({ seconds, toleranceSeconds: Math.max(2, seconds * .08), format, captions: true, minSources: 0, html: true, originalOnly: false, requiredWords: [], ...extra });
const define = (id: string, category: EvaluationCategory, name: string, description: string, messages: string[], expectation: EvaluationExpectation): EvaluationCase => ({ id, category, name, description, messages, expectation, fixtureIds: [], threshold: 80, enabled: true, version: 1, updatedAt: '2026-10-02T00:00:00.000Z' });

export function initialEvaluationCases(): EvaluationCase[] {
  return [
    define('hot-ai-45', 'hot-news', '今日 AI 热点解读', '检查真实检索、新闻时效、事实口径及紧凑旁白。', ['生成一个讲解今日AI热点的45秒竖屏视频，选一个有可靠报道的事件，用HTML图解、原理或因果动画说明，带字幕，旁白每秒4.6字。不要品牌角注和资料ref。'], expected(45, '9:16')),
    define('hot-robot-45', 'hot-news', '机器人新闻的事实与观点', '区分报道数据、推论与尚未证实的判断。', ['制作一个45秒竖屏机器人领域近3天新闻解读视频，联网查证事件和数字，解释发生了什么、为什么重要及有哪些限制，用HTML动画和字幕，语速紧凑。'], expected(45, '9:16')),
    define('hot-pick-35', 'hot-news', '选题到成片的两轮指令', '测试真实选题列表的指代与后续视频路由。', ['搜集AI领域近3天热点，给我2个适合制作短视频的选题，附原文来源，先不要生成视频。', '把第1个选题做成35秒竖屏视频，用HTML动态图解，带字幕，语速紧凑。'], expected(35, '9:16')),
    define('knowledge-loss-240', 'knowledge', '损失函数变迁史', '原始指令回归：概念递进、年代、公式与演算。', ['生成一个从浅入深讲解损失函数变迁史的教学视频'], expected(240, '16:9', { toleranceSeconds: 36, requiredWords: ['损失', '误差'] })),
    define('knowledge-cross-45', 'knowledge', '交叉熵的直观解释', '零基础解释和具体数值例子，图解对应实际旁白。', ['生成一个45秒横屏知识科普视频，向零基础观众解释交叉熵为什么惩罚自信但错误的预测，给出一个具体数值例子，用HTML概率图解和字幕，不要无关角注。'], expected(45, '16:9', { requiredWords: ['概率'] })),
    define('knowledge-rag-60', 'knowledge', 'RAG 与微调的选择', '结构化比较、适用场景与限制，不虚构技术结论。', ['生成一个60秒横屏知识科普视频，解释RAG与微调的区别，从直观比喻到适用场景，再总结选择方法，用HTML对比图和流程动画，带字幕。'], expected(60, '16:9')),
    define('edit-original-20', 'multi-video', '两段素材的原声剪辑', '素材来源、完整原话、字幕、声音一致性与时长。', ['把上传的多段视频剪成20秒竖屏成片，至少使用两段素材，围绕一个共同主题，保留完整原话和原声，带字幕和轻推近，音量统一，不要新配音和背景音乐。'], expected(20, '9:16', { html: false, minSources: 2, originalOnly: true })),
    define('edit-fine-35', 'multi-video', '口播选句与论证', '精剪必须有源原话、时间码、选择理由及完整句子。', ['对上传的多段口播视频进行精剪，生成35秒竖屏成片，至少使用两段素材，删重复，组织成痛点、观点、论证和结论，保留完整原话和原声，逐句字幕，音量一致，不要新配音。'], expected(35, '9:16', { html: false, minSources: 2, originalOnly: true })),
    define('edit-revise-15', 'multi-video', '修改方案后重新导出', '两轮修改检查时长、画幅和新产物，避免版本更新但文件未变。', ['把上传的多段视频剪成20秒竖屏成片，至少使用两段素材，保留原声和完整句子，加字幕，不要新配音。', '改成15秒横屏，保留字幕与原声，音量统一，重新生成成片。'], expected(15, '16:9', { html: false, minSources: 2, originalOnly: true })),
  ];
}
