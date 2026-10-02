# 轻剪 Motion Design 接入

来源：https://github.com/LottieFiles/motion-design-skill

上游 skill 位于 `skills/motion-design`，固定来源 commit 见 `UPSTREAM.json`，保留 MIT `LICENSE`。它提供动效设计规则，不包含可直接播放的 Lottie 动画资产。本次不新增 npm 依赖，不连接外部动画素材服务。

`loadMotionDesignContext()` 将核心 skill、编排规则、群组和背景配方，以及轻剪组件参考实际注入叙事规划和 `authorDrawing` 模型。仅将文件放进 skills 目录不会自动赋予模型能力。

运行时沿用 GSAP 3.14.2 与 HyperFrames。`server/motionComponents.ts` 提供统一的暂停、有限、确定性时间轴组件。分镜设计返回 `HtmlDrawing.motion` 风格和节点数据，再编译为入场、路径绘制、重点聚焦与背景浮动；原有分镜数据省略 motion 时使用 corporate。模板与重建分镜共享组件。

后台新增 SOP流程推进、因果链路、趋势图解、成果揭示。新实例自动初始化，旧目录通过 `motion-design-v1` 标记一次性增补。已有模板内容、停用状态保留；管理员随后删除模板不会在重启时重新加入。

最少输入示例：

- `生成因果链路动效视频，标题「明确需求，减少返工」`
- `生成SOP流程推进动效视频`
- 附加真人素材后：`保留原声，用HTML绘制因果关系和流程，生成视频`

趋势和成果模板明确标为示意。模型不得添加无来源的统计数字。实际知识短片仍执行转写、选句、编排、渲染和声音/视觉审查；此 skill 不替代这些工具。

验证包括组件倒序 seek 后一致性、有限时间轴、旧目录自定义/删除保留、实际模型上下文加载，以及 HTML lint、浏览器布局检查、MP4 实测和 H5 成品播放。
