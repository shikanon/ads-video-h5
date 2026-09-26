# 轻剪 HTML 视频特效

本地后台 `/admin`（线上 `https://video.shikanon.com/qingjian/admin`）→「HTML 视频特效」可编辑特效源码和默认文案，预览时间轴，渲染 MP4 并下载。对话内输入「生成阳光开场特效视频，标题『去看更大的世界』」可直接调用启用模板；生成视频归属当前会话，同时进入成片库和素材库。

## 动效组件与模板

轻剪的 `QJMotion` 组件包括 `textRise`、`cardPop`、`lineDraw`、`imageDrift`、`splitWipe`、`fadeOut`。每个组件向暂停的 GSAP 时间轴添加确定性的动画；模板的 `main` 合成注册到 `window.__timelines.main`，由 HyperFrames 逐帧渲染。模板源码、默认文案、画幅、时长、启用状态保存在 `$QINGJIAN_DATA_DIR/html-effects/catalog.json`，后台修改后不会被代码部署覆盖。渲染记录与 MP4 保存在同目录的 `renders.json`、`renders/`。

首批演示视频均为 1080×1920、6 秒、24 FPS：

| 模板 | 用途 | 演示 MP4 |
| --- | --- | --- |
| 阳光开场 | 海岸意象与主标题入场 | [sunny-opening.mp4](../public/effects/sunny-opening.mp4) |
| 照片推镜 | 真人照片缓慢平移与信息卡片 | [photo-drift.mp4](../public/effects/photo-drift.mp4) |
| 故事收束 | 片尾文案和品牌落版 | [story-outro.mp4](../public/effects/story-outro.mp4) |

三个片段拼成的 17 秒展示片：[showcase.mp4](../public/effects/showcase.mp4)。它由 HTML 渲染后的片段交叉淡入拼接，并叠加轻剪原创的内置配乐。

演示文件可由 `pnpm tsx scripts/render-effect-demos.ts` 重建。照片演示采用仓库已有的海岸素材，素材来自产品 Landing。默认模板无照片时显示渐变底色；正式使用前检查所选 HTTPS 图片是否能被渲染进视频。

## 后台 API

所有接口要求管理员 Bearer 令牌。读取模板：`GET /api/admin/effects`；增加、修改、删除：`POST /api/admin/effects`、`PUT/DELETE /api/admin/effects/:id`。草稿预览：`POST /api/admin/effects/preview-draft`，请求体 `{effect,values}`，响应 `{html}`。渲染：`POST /api/admin/effects/:id/render`，请求体 `{values}`，返回任务 ID；`GET /api/admin/effects/renders/:id` 查询状态，`GET /api/admin/effects/renders/:id/download` 下载 MP4。`GET /api/admin/effects/renders` 返回最近渲染记录。普通用户可通过 `GET /api/effects` 查看已启用模板摘要，但不能读取 HTML 源码。

画幅支持 9:16、16:9、1:1；时长 1–15 秒。用户文案通过 `textContent` 写入，图片只接受 HTTPS URL。后台 HTML 只允许可信管理员编辑，预览 iframe 设置 `sandbox="allow-scripts"`。渲染进程单任务运行，设有 180 秒超时；失败记录错误，后续任务可重试。轻剪技能在 [skills/qingjian-html-video](../skills/qingjian-html-video/SKILL.md)，可通过后台 API 列出模板、渲染并下载到本地。

## 运行环境

服务端需 Node、HyperFrames、GSAP、FFmpeg、FFprobe 和 Chrome/Chromium。Node 依赖由 `pnpm install --frozen-lockfile` 安装；线上渲染浏览器应按 [部署说明](DEPLOYMENT.md) 以 `qingjian` 服务帐号安装到持久缓存，`pnpm hyperframes doctor` 可辅助检查。生产机器已有 FFmpeg/FFprobe 时直接使用。浏览器缓存不应放在 Git 仓库，也不应在带密钥的构建环境里执行第三方安装脚本。
