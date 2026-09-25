# BGM 来源调查与接入边界

调查日期：2026-09-26。目标站：[Pixabay 音乐](https://pixabay.com/zh/music/)、[24bit](https://www.24bit.net/)。

## 本地浏览器抓包

- Pixabay：在中文音乐页输入“轻快”后，浏览器打开 `/zh/music/search/%E8%BD%BB%E5%BF%AB/`，页面展示曲目、试听和下载按钮。点击 `Baby Smile` 的下载按钮后，浏览器请求 `https://cdn.pixabay.com/download/audio/2024/02/08/audio_b816f864f0.mp3?filename=angel4leon-baby-smile-190123.mp3`。搜索属于页面导航；没有在本次流量中观察到公开的音乐搜索 JSON API。
- 24bit：搜索框输入“舒缓”后，浏览器同时发送 `POST /api/player/searchOnlineMusicOne` 和 `POST /api/player/searchOnlineMusicTwo`，请求体为 `{"keyword":"%E8%88%92%E7%BC%93","page":1}`。另发送 `POST /api/player/setKeyword`。该次浏览器请求返回 HTTP 522，未拿到可验证的搜索结果 JSON；页面保留了上一次搜索结果。曲目页面链接形如 `/music/c/<id>`，但尚未验证可用的音频下载接口。

## 不带浏览器凭据的请求复现

执行 `node scripts/probe-bgm-sources.mjs`。本地网络得到：Pixabay 搜索 403、24bit 的两个搜索 POST 均为 403、Pixabay 单曲 CDN MP3 下载 200（`audio/mpeg`，1,712,796 字节）。新建无登录浏览器访问两站也遇到防护页。探测脚本不复用个人浏览器 Cookie、不解验证码、不绕过站点限制。

Pixabay 的[公开 API 文档](https://pixabay.com/api/docs/)只列出图片与视频搜索，没有音乐搜索 API。[服务条款](https://pixabay.com/service/terms/)限制未经授权的自动提取与抓取。因此轻剪不把页面解析或私有接口伪装成可用的正式音乐 API。24bit 页面含商业发行曲目，站点页面本身不能证明每首歌可用于用户视频。

## 产品接入

对话发起 BGM 搜索时，Pi Agent 用受校验工具整理关键词，H5 提供两个原站入口。用户在原站试听、下载并确认使用权，回到轻剪上传音频后通过对话选作 BGM。对用户明确粘贴的 Pixabay 官方 CDN MP3 链接，服务端只接受 `https://cdn.pixabay.com/download/audio/...mp3`，限制 25 MB、校验内容类型和音频时长，再保存到素材库并选作当前会话 BGM。远程服务器可使用同一脚本检查站点状态；若搜索仍被拒绝，不能据此宣称自动搜索已经跑通。
