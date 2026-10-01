# 产品介绍视频

首页「认识轻剪」和 README 使用同一支 96 秒的产品介绍片：1920×1080、30fps、H.264 + AAC，原创 120 BPM 配乐。视频展示对话剪辑、素材库、时间线、表达动效与知识短片重构；重构流程图明确标为示意。

## 存储与接入

- MP4、封面和可编辑 HyperFrames 工程 ZIP 均放在现有 OSS Bucket 的 `qingjian/marketing/launch/` 中，与用户素材目录分开。
- 路径包含 SHA-256 前 16 位，使用一年不可变缓存；更换文件会产生新 URL。
- `public/product-video.json` 保存公开 URL、字节数和完整 SHA-256。`src/productVideo.ts` 为首页使用的静态元数据，避免额外网络请求。
- 首页视频使用原生控制条、`playsInline` 和 `preload="none"`，用户主动播放时才加载 MP4；手机保持 16:9。首屏「96 秒了解轻剪」链接跳转到介绍区。
- README 使用可点击封面兼容 GitHub 的 Markdown 视频展示限制。

## 制作与更新

从 README 的可编辑工程链接下载 ZIP，解压后按其中 README 修改脚本、分镜、配乐或界面素材并重新渲染。工程包含独立的章节 HTML、GSAP 动画、真实界面截图和原始音轨，无产品后台密钥。完整第三方付费技能未安装，本片按其公开风格描述独立制作。

发布新版本时，将成片、封面与工程 ZIP 放到本机 `videos/qingjian-launch/renders/`，保持文件名 `qingjian-launch-1080p.mp4`、`qingjian-launch-poster.jpg`、`qingjian-launch-editable.zip`。凭据由被 Git 忽略的 `data/oss.env` 提供：

```sh
node scripts/publish-product-video.mjs
```

脚本上传并匿名验证文件大小后生成公开元数据。若新版本的时长或画幅改变，先更新脚本中的对应值及首页文案。同步 README 链接，运行 `pnpm build`，完成桌面与手机预览及从头至尾播放检查后提交、推送；服务器通过现有 `qingjian-cd.timer` 部署。

视频二进制和 ZIP 存在 OSS，不加入 Git。验证线上版本时应同时核对 `/qingjian/api/health` 的 revision、`/qingjian/product-video.json` 元数据、页面播放器实际来源和播放状态。
