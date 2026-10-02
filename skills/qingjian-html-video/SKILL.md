---
name: qingjian-html-video
description: Create, preview, edit, and render short branded HTML motion videos in the Qingjian effect library; use when asked to make a Qingjian intro, photo motion card, caption outro, or reusable HTML video effect.
---

# 轻剪 HTML 视频

## 成片中的 HTML 分镜

当当前工具集包含 `write_rebuilt_script`、`produce_scenes` 时，使用这些真实工具制作知识短片，不必打开后台或让用户手动选模板。该模式由模型设计新信息图，经 GSAP/HyperFrames 实际渲染，再进入混合时间线。后台模板仅用于独立短特效。

脚本至少安排一段 `visual=html`：按台词绘制因果图、场景示意、步骤路径或可辨认成果；至少保留一段真人呈现。设计时把动效意图写进 visualBrief：主信息入场、关系连线、重点聚焦、低幅度背景运动，整片风格一致。`mode=original, visual=html` 表示只换画面，完整音轨从原视频提取，不生成配音、不改变原话。HTML 画面需要真实绘制节点与连接关系，单纯字幕、推镜、圈注、片头模板或复用素材不等同于新 HTML 分镜。

`produce_scenes` 必须生成并检查 HTML、渲染 MP4、保存 htmlHash/audioHash，再由 `arrange_timeline` 将生成媒体 ID 放入成片。失败时修正布局或报告具体阶段，不能退回全原视频却声称已完成 HTML 制作。交付以实际生成的 HTML 文件、哈希、分镜媒体和时间线为证据。

用轻剪的动效库制作短视频。模板由管理员维护；普通用户在轻剪对话里说「生成阳光开场特效视频，标题『…』」即可得到可预览、下载、继续剪辑的素材。画面规范见仓库 `DESIGN.md`。

## 工作方式

1. 明确要传达的一句话、画幅、照片或视频素材，以及入场、停留、收束的节奏。默认使用竖屏 1080×1920、6 秒。
2. 优先复用后台已有模板（阳光开场、照片推镜、故事收束）。需要新风格时，在 `/admin` 的「HTML 视频特效」中复制模板，修改 HTML、默认文案和时间轴，再预览。
3. 元素要有可寻址的 `id`、`data-start`、`data-duration`、`data-track-index`。根节点使用 `data-composition-id="main"`；GSAP 时间轴暂停创建并注册到 `window.__timelines["main"]`。保留 `<!--QJ_RUNTIME-->` 和 `<!--QJ_DATA-->` 插槽。
4. 按已安装的 [Motion Design](../motion-design/SKILL.md) 先确定情绪、动效风格、主信息与次层，再使用 `QJMotion` 组件编排画面：`textRise`、`cardPop`、`lineDraw`、`imageDrift`、`splitWipe`、`fadeOut`，以及 `staggerReveal`、`cardSettle`、`focusPulse`、`ambientFloat`、`connectorFlow`、`barGrow`、`radialBurst`。入口从 0.1–0.3 秒开始；文字要留足阅读时间，结尾动作快于入场。参数和示例见 [组件参考](references/components.md)。
5. 用后台预览检查安全区、字数、文字与图片对比度，再渲染 MP4。用 FFprobe 核对画幅、帧率、时长，并抽取中间帧检查视觉。生成后由对话或后台下载。

## 命令行快速制作

仓库安装依赖后，可使用本技能自带脚本调用后台渲染接口。管理员令牌从 `QINGJIAN_ADMIN_TOKEN` 或 git 忽略的 `data/admin-token` 读取，绝不放进命令参数或提交仓库。

```bash
node skills/qingjian-html-video/scripts/render.mjs --list
node skills/qingjian-html-video/scripts/render.mjs --effect sunny-opening --title "去看更大的世界" --subtitle "沿着海风走" --output ./data/my-opening.mp4
node skills/qingjian-html-video/scripts/render.mjs --effect photo-drift --image-file ./data/coast.jpg --output ./data/my-photo.mp4
```

默认连接本机 `http://127.0.0.1:8787`。使用远程服务时传 `--server https://video.shikanon.com/qingjian`；远程地址必须是 HTTPS。用 `--image-file` 或 `--video-file` 选择本地素材，脚本先上传，再渲染视频。普通用户也可在 H5 对话里直接说「生成照片推镜特效视频」并附加已上传图片或视频。

## 边界

- 不把用户输入拼成可执行 HTML。标题、副标题和已上传素材标识作为数据注入，文本只写入 `textContent`。
- 后台 HTML 可运行脚本，只授权可信管理员编辑；预览在沙盒 iframe 中打开。
- 不在源码、模板、示例或日志中写入 API Key、管理员令牌、会话 Cookie。
- 素材无法读取时渲染会失败；交付前确认图片或视频确实进入 MP4。
