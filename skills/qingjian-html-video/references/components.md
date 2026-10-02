# 轻剪动效组件

组件在服务端编译 HTML 时注入为全局 `QJMotion`。它们都向传入的已暂停 GSAP 时间轴加入确定性的 tween。`at` 是秒数。

| 组件 | 用途 | 参数 |
| --- | --- | --- |
| `textRise(tl, selector, at)` | 文字上移、淡入、去模糊 | 默认 `at=0.2` |
| `cardPop(tl, selector, at)` | 卡片缩放、轻微回弹 | 默认 `at=0.35` |
| `lineDraw(tl, selector, at)` | 强调线从左侧展开 | 默认 `at=0.7` |
| `imageDrift(tl, selector, at, duration)` | 照片缓慢推镜和平移 | 默认 `at=0.2, duration=4.8` |
| `splitWipe(tl, selector, at)` | 左到右遮罩揭示 | 默认 `at=0.18` |
| `fadeOut(tl, selector, at, duration)` | 快速淡出、上移 | 自定退出时间，默认 `duration=0.3` |
| `keywordPunch(tl, selector, at)` | 强调核心观点，克制的放大淡入 | 默认 `at=.3` |
| `lowerThird(tl, selector, at)` | 来源或观点标签横移进入 | 默认 `at=.4` |
| `chapterProgress(tl, selector, at, duration)` | 显示本章阅读进度 | 默认 `at=.4, duration=4.8` |
| `compareReveal(tl, selector, at)` | 对比内容依次揭示 | 默认 `at=.6`，元素间隔 `.18` 秒 |

时间轴示例：

```html
<h1 id="title" data-qj-field="title" data-start="0" data-duration="6" data-track-index="2"></h1>
<script>
  const tl = gsap.timeline({ paused: true });
  QJMotion.textRise(tl, '#title', 0.42);
  QJMotion.fadeOut(tl, '#title', 5.55, 0.25);
  window.__timelines["main"] = tl;
  tl.seek(0);
  if (window.__QJ_PREVIEW__) tl.play(0);
</script>
```

可用文案字段：`eyebrow`、`title`、`subtitle`、`accent`。文字用 `data-qj-field`，图片或视频容器用 `data-qj-image`；素材通过后台本地文件选择上传，渲染请求传 `assetId`，服务端将对应媒体注入画面。视频根节点的时长、宽高由后台表单覆盖，支持 9:16、16:9、1:1，时长 1–15 秒。

模板文件存在服务端持久目录 `html-effects/catalog.json`；由后台保存，不随代码部署覆盖。仓库内种子模板由 `server/htmlEffects.ts` 提供，新实例首次启动时创建。渲染使用 HyperFrames 的时间轴与 MP4 编码；设计原则参考 [motion-skills](https://github.com/iart-ai/motion-skills) 的节奏、安全区和逐帧检查思路，代码和组件为轻剪独立实现。

## 绑定精剪分镜的绘制组件

精剪时间线 `motions` 可指定 `circle`、`underline`、`arrow` 和 `steps`，每段绑定 sceneId、start/end、label 和 top/bottom 安全区域。`QJMotion.drawStroke` 使用 SVG 路径实际长度和 GSAP strokeDashoffset 绘制，`markerSweep` 提供笔刷横向标记；均为同步、可定位到帧的有限时间动画。文字保持 text/HTML 转义，不允许输入自定义脚本。组件以 HyperFrames 子合成进入透明图层，然后与原声素材合成；不是仅供后台预览的模板。

## Motion Design 扩展

项目已安装 [LottieFiles motion-design](../../motion-design/SKILL.md)，保留 MIT 许可和 `UPSTREAM.json` 来源。设计模型和叙事 Agent 会实际加载核心规则及编排、群组、背景运动配方。离线视频需适配台词的阅读时间，不照搬 UI 的瞬时交互节奏。

新增组件均使用同一暂停时间轴，无需联网资产或 Lottie 播放器：

| 组件 | 用途 | 参数 |
| --- | --- | --- |
| `staggerReveal(tl, selector, at, duration, ease)` | 列表依阅读顺序进入，总错开最多 .4 秒 | `.2, .45, power3.out` |
| `cardSettle(tl, selector, at, duration, ease)` | 卡片入场并落稳，按风格选缓动 | `.2, .5, power3.out` |
| `focusPulse(tl, selector, at, duration)` | 核心节点短暂聚焦后归位 | `1.4, .6` |
| `ambientFloat(tl, selector, at, duration, amplitude)` | 背景低幅度浮动，有限时长 | `.2, 4, 8px` |
| `connectorFlow(tl, selector, at, duration)` | 按 SVG 实际路径长度绘制连接关系 | `.5, .7` |
| `barGrow(tl, selector, at, duration)` | 图表从底部生长 | `.4, .8` |
| `radialBurst(tl, selector, at, radius)` | 确定性径向粒子，有限出现和收束 | `1, 36px` |

新增模板：SOP流程推进、因果链路、趋势图解、成果揭示。可直接说「生成因果链路动效视频」；它们生成可下载 MP4，并能加入后续剪辑。已有后台目录启动时一次性增补；不覆盖管理员修改、停用配置或再次加入已删除的模板。

知识短片的 `HtmlDrawing.motion` 可选 corporate/premium/playful/energetic（默认 corporate）。模型按叙事选择风格，代码将节点、连线、聚焦和背景运动编译为 QJMotion 时间轴，渲染前执行实际布局检查。数据图必须绑定来源；模板中的趋势与成果明确标为示意。
