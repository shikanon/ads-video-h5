# 轻剪 HTML 视频特效

管理控制台是 `apps/admin/` 下的独立前端项目。开发地址 `http://127.0.0.1:5174/`，本机正式后台 `/admin/`，线上 `https://video.shikanon.com/qingjian/admin/`。进入「HTML 视频特效」即可看到每个特效的真实 HTML 动画卡片，按文字、动画、图片与视频筛选，播放、暂停、重播或拖动进度；页面不展示 HTML 时间轴源码。选中特效可修改默认文案、启用状态和预览素材，实时查看效果，再渲染 MP4 并下载。对话内输入「生成阳光开场特效视频，标题『去看更大的世界』」可直接调用启用模板；生成视频归属当前会话，同时进入成片库和素材库。

## 动效组件与模板

轻剪的 `QJMotion` 组件包括 `textRise`、`cardPop`、`lineDraw`、`imageDrift`、`splitWipe`、`fadeOut`。每个组件向暂停的 GSAP 时间轴添加确定性的动画；模板的 `main` 合成注册到 `window.__timelines.main`，由 HyperFrames 逐帧渲染。模板源码、默认文案、画幅、时长、启用状态保存在 `$QINGJIAN_DATA_DIR/html-effects/catalog.json`，后台修改后不会被代码部署覆盖。渲染记录与 MP4 保存在同目录的 `renders.json`、`renders/`。

首批演示视频均为 1080×1920、6 秒、24 FPS：

| 模板 | 用途 | 演示 MP4 |
| --- | --- | --- |
| 阳光开场 | 海岸意象与主标题入场 | [sunny-opening.mp4](../public/effects/sunny-opening.mp4) |
| 照片推镜 | 真人照片缓慢平移与信息卡片 | [photo-drift.mp4](../public/effects/photo-drift.mp4) |
| 故事收束 | 片尾文案和品牌落版 | [story-outro.mp4](../public/effects/story-outro.mp4) |

三个片段拼成的 17 秒展示片：[showcase.mp4](../public/effects/showcase.mp4)。它由 HTML 渲染后的片段交叉淡入拼接，并叠加轻剪原创的内置配乐。

演示文件可由 `pnpm tsx scripts/render-effect-demos.ts` 重建。照片演示采用仓库已有的海岸素材，素材来自产品 Landing。后台可直接从本地选择图片或视频上传，并再次选用已上传素材。默认模板无素材时显示渐变底色；正式使用前检查所选素材是否进入视频。

## 后台 API

所有后台接口要求登录返回的管理员 Bearer 会话；默认 admin 账号支持 Authenticator 动态验证码，历史 admin-token 不再用于 API 鉴权。读取模板：`GET /api/admin/effects`；增加、修改、删除：`POST /api/admin/effects`、`PUT/DELETE /api/admin/effects/:id`。上传素材：`POST /api/admin/effects/assets`，以 multipart `file` 传本地图片或视频；`GET /api/admin/effects/assets` 列出可复用素材。单个已保存特效预览：`POST /api/admin/effects/:id/preview`，请求体 `{values?}`；草稿预览：`POST /api/admin/effects/preview-draft`，请求体 `{effect,values}`，其中 `values.assetId` 引用上传素材。两者均响应 `{html,previewId}`，HTML 内含与渲染相同的模板和独立播放控制通道。渲染：`POST /api/admin/effects/:id/render`，请求体 `{values}`，返回任务 ID；`GET /api/admin/effects/renders/:id` 查询状态，`GET /api/admin/effects/renders/:id/download` 下载 MP4。`GET /api/admin/effects/renders` 返回最近渲染记录。普通用户可通过 `GET /api/effects` 查看已启用模板摘要，但不能读取 HTML 源码。

画幅支持 9:16、16:9、1:1；时长 1–15 秒，由特效模板决定。用户文案通过 `textContent` 写入，图片支持 JPG、PNG、WebP（20 MB 内），视频支持 MP4、WebM、MOV（100 MB 内）；文件先在浏览器检查大小、服务端再校验，然后保存到持久目录并同步至已配置的 OSS。HTML 模板仍可通过可信管理员 API 或持久化目录维护，预览 iframe 设置 `sandbox="allow-scripts"`，以 CSP 禁止网络脚本、连接、表单和插件，不共享后台存储。动画按真实时间轴逐帧预览，离开视口或隐藏页面自动暂停。渲染进程单任务运行，设有 180 秒超时；失败记录错误，后续任务可重试。轻剪技能在 [skills/qingjian-html-video](../skills/qingjian-html-video/SKILL.md)，可通过后台 API 列出模板、渲染并下载到本地。

## 运行环境

服务端需 Node、HyperFrames、GSAP、FFmpeg、FFprobe 和 Chrome/Chromium。Node 依赖由 `pnpm install --frozen-lockfile` 安装；线上渲染浏览器应按 [部署说明](DEPLOYMENT.md) 以 `qingjian` 服务帐号安装到持久缓存，`pnpm hyperframes doctor` 可辅助检查。生产机器已有 FFmpeg/FFprobe 时直接使用。浏览器缓存不应放在 Git 仓库，也不应在带密钥的构建环境里执行第三方安装脚本。
