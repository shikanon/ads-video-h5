---
name: qingjian-html-video
description: Create, preview, edit, and render short branded HTML motion videos in the Qingjian effect library; use when asked to make a Qingjian intro, photo motion card, caption outro, or reusable HTML video effect.
---

# 轻剪 HTML 视频

用轻剪的动效库制作短视频。模板由管理员维护；普通用户在轻剪对话里说「生成阳光开场特效视频，标题『…』」即可得到可预览、下载、继续剪辑的素材。画面规范见仓库 `DESIGN.md`。

## 工作方式

1. 明确要传达的一句话、画幅、照片或视频素材，以及入场、停留、收束的节奏。默认使用竖屏 1080×1920、6 秒。
2. 优先复用后台已有模板（阳光开场、照片推镜、故事收束）。需要新风格时，在 `/admin` 的「HTML 视频特效」中复制模板，修改 HTML、默认文案和时间轴，再预览。
3. 元素要有可寻址的 `id`、`data-start`、`data-duration`、`data-track-index`。根节点使用 `data-composition-id="main"`；GSAP 时间轴暂停创建并注册到 `window.__timelines["main"]`。保留 `<!--QJ_RUNTIME-->` 和 `<!--QJ_DATA-->` 插槽。
4. 使用 `QJMotion` 组件编排画面：`textRise`、`cardPop`、`lineDraw`、`imageDrift`、`splitWipe`、`fadeOut`。入口从 0.1–0.3 秒开始；文字要留足阅读时间，结尾动作快于入场。参数和示例见 [组件参考](references/components.md)。
5. 用后台预览检查安全区、字数、文字与图片对比度，再渲染 MP4。用 FFprobe 核对画幅、帧率、时长，并抽取中间帧检查视觉。生成后由对话或后台下载。

## 命令行快速制作

仓库安装依赖后，可使用本技能自带脚本调用后台渲染接口。管理员令牌从 `QINGJIAN_ADMIN_TOKEN` 或 git 忽略的 `data/admin-token` 读取，绝不放进命令参数或提交仓库。

```bash
node skills/qingjian-html-video/scripts/render.mjs --list
node skills/qingjian-html-video/scripts/render.mjs --effect sunny-opening --title "去看更大的世界" --subtitle "沿着海风走" --output ./data/my-opening.mp4
```

默认连接本机 `http://127.0.0.1:8787`。使用远程服务时传 `--server https://video.shikanon.com/qingjian`；远程地址必须是 HTTPS。照片模板可传 `--image-url`，地址需为公开可读取的 HTTPS 图片。普通用户也可在 H5 对话里直接说「生成照片推镜特效视频」并附加已上传图片。

## 边界

- 不把用户输入拼成可执行 HTML。标题、副标题、图片 URL 作为数据注入，文本只写入 `textContent`。
- 后台 HTML 可运行脚本，只授权可信管理员编辑；预览在沙盒 iframe 中打开。
- 不在源码、模板、示例或日志中写入 API Key、管理员令牌、会话 Cookie。
- 图片无法读取时会显示模板底色；交付前确认图片确实进入 MP4。
