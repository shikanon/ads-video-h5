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
