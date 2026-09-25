# 轻剪 · 对话式智能剪辑 H5

通过一句话描述剪辑要求，生成片段方案，再由 FFmpeg 合成 MP4 并下载到本地。界面面向手机设计，也可在桌面浏览器中使用。

![H5 视觉稿](docs/h5-concept.png)

更多页面状态见 [功能展示视觉稿](docs/UI_STATES.md)：本地图片附件输入、口播文案与音频试听、剪辑拼接页。这三张是后续功能设计稿，当前原型尚未实现对应操作。

## 快速开始

需要 Node.js 24 和 pnpm。克隆仓库后运行：

```bash
pnpm install
pnpm dev
```

打开 <http://127.0.0.1:5173/>。开发时 Vite 运行在 5173 端口，API 运行在 8787 端口。上传的视频、剪辑方案和导出的文件保存在本机 `data/`，不提交到 Git。

默认是**演示剪辑规则**：按上传顺序和对话中的时长、比例选片段。它会真实调用 FFmpeg 生成 MP4；界面会明确标注演示模式。

## 启用 Pi Agent

在启动服务前，于服务端环境设置 `OPENAI_API_KEY`。可选设置 `PI_MODEL`（默认 `gpt-5-mini`）：

```bash
export OPENAI_API_KEY='your-key'
export PI_MODEL='gpt-5-mini'
pnpm dev
```

Pi Agent 使用 [`@earendil-works/pi-agent-core`](https://github.com/earendil-works/pi/tree/main/packages/agent) 的 Agent 循环和 `propose_edit` 工具。工具会校验每个片段的素材 ID、时间范围及总时长，随后由 FFmpeg 执行。密钥只在服务端读取，浏览器不会收到密钥。Agent 当前只能读取文件名和时长，无法识别画面内容，因此不会宣称已自动找到真实的“精彩镜头”。

## 当前范围

- 一次最多上传 6 个视频，每个最大 300 MB。
- 对话生成最长 60 秒、最多 8 个片段的方案；支持 9:16、16:9、1:1。
- 合成 MP4，预览并通过浏览器下载。
- 片段以裁切、缩放和拼接为主；保留源音轨，静音素材使用静音音轨。
- 单机本地原型：一个工作区，无登录和多用户隔离。文件保存在运行服务的机器上。

完整的页面流程、Logo 菜单和功能验收见 [产品需求文档](docs/PRD.md)。
