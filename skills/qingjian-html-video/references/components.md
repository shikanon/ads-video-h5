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

可用数据字段：`eyebrow`、`title`、`subtitle`、`imageUrl`、`accent`。文字用 `data-qj-field`，图片容器用 `data-qj-image`；服务端会把用户内容编码为安全 JSON 后注入。视频根节点的时长、宽高由后台表单覆盖，支持 9:16、16:9、1:1，时长 1–15 秒。

模板文件存在服务端持久目录 `html-effects/catalog.json`；由后台保存，不随代码部署覆盖。仓库内种子模板由 `server/htmlEffects.ts` 提供，新实例首次启动时创建。渲染使用 HyperFrames 的时间轴与 MP4 编码；设计原则参考 [motion-skills](https://github.com/iart-ai/motion-skills) 的节奏、安全区和逐帧检查思路，代码和组件为轻剪独立实现。
