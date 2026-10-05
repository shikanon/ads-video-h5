export function creationBrief(prompt:string) {
  const genre=/宣传|公益|招新|广告|推广|campaign|promot/i.test(prompt)?'promotion':/教程|步骤|操作|流程|tutorial|how.to/i.test(prompt)?'tutorial':/寓言|故事|story/i.test(prompt)?'story':/产品|商品|功能介绍|product/i.test(prompt)?'product':'knowledge';
  const guides={
    promotion:'围绕主题与目标受众建立开场、行动价值、具体行动和结尾号召。不得强行加入课堂公式或学术历史，也不得虚构销量、评价、活动时间地点或承诺。',
    tutorial:'围绕实际任务组织准备、按顺序操作、检查结果和常见失误。用步骤图解清楚表达动作，不用抽象知识卡代替操作。界面示意须标明示意，不能声称真实执行过软件。',
    story:'按起因、变化与结尾组织叙事。寓言和虚构情节须作为虚构示意，不冒充真实新闻或史实；历史事实仍须真实来源支持。',
    product:'围绕产品用途、关键机制、使用场景及限制讲述；根据已核验资料或明确给出的简报，不虚构品牌参数、销售数据或效果。缺少实拍可以使用清楚标注的示意图。',
    knowledge:'围绕受众建立问题、直观解释、具体例子和回顾；概念与事实根据真实资料核验。',
  };
  return {genre,guide:guides[genre],instruction:'依据本次内容类型制作，不能把每个主题都变成损失函数课堂。章节role是内部编排槽位：hook开场，foundation必要信息，development展开，application行动或例子，recap收束。至少包含hook、foundation、recap，第一章hook、最后一章recap；不要漏掉基础信息槽位。用户的主题、时长、画幅、是否出片和原声约束优先。遇到错误先利用已有状态、调整查询或修复对应参数，不要求用户重述明确的任务。'};
}
