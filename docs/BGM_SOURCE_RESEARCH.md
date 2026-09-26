# BGM 来源抓包与请求封装

调查日期：2026-09-26。目标站：[Pixabay 音乐](https://pixabay.com/zh/music/)、[24bit](https://www.24bit.net/)。以下记录用于网页请求流程验证；正式使用需确认站点接口和具体曲目的授权范围。不绕过 CAPTCHA、Cloudflare 或其他访问控制。

## 浏览器观察到的流程

### Pixabay

1. 音乐搜索是页面导航：`GET /zh/music/search/<URL 编码关键词>/`。本次浏览器打开“轻快”结果页，HTML 标题显示 1106 首结果；没有观察到音乐搜索 JSON 请求。
2. 搜索结果卡片包含曲名、作者、详情页链接和封面图，不包含可直接使用的 MP3 地址。详情页 HTML 中嵌有下载地址，例如 `https://cdn.pixabay.com/download/audio/...mp3?filename=...mp3`。
3. 详情页的“免费下载”会请求 Pixabay 官方 CDN。浏览器此次点击被本机客户端拦截（`ERR_BLOCKED_BY_CLIENT`）；同一详情页地址由普通 Node 请求获得 HTTP 200、`audio/mpeg`。这不是对网页下载按钮端到端成功的证明。
4. 当前服务端从本机直连 Pixabay 搜索页得到 403 Cloudflare 页面，而浏览器导航得到 200。因此 `POST /api/music/search` 会明确返回 `UPSTREAM_CHALLENGE`，不会把防护 HTML 解析成空结果或伪造成功。

### 24bit

搜索框提交“轻快”时浏览器发送：

- `POST /api/player/searchOnlineMusicOne`，JSON：`{"keyword":"%E8%BD%BB%E5%BF%AB","page":1}`
- `POST /api/player/searchOnlineMusicTwo`，请求体相同
- `POST /api/player/setKeyword`，JSON：`{"keyword":"%E8%BD%BB%E5%BF%AB"}`（线上实际值为 UTF-8 URL 编码字符串）

首轮通过站内搜索控件提交时，这三条请求都收到 HTTP 403 和 `cf-mitigated: challenge`，页面保留此前结果。后来在已有同源会话的 Chrome 页面里显式用 `credentials: include` 重放时三条均返回 200；对照细节见下文“真实浏览器凭据对照”。

曲目详情页的下载交互会 `POST /api/music/getOnlineDownload`，请求体字段为 `{type,name,player,album}`；本次样本为 `{"type":"c","name":"Free Loop","player":"甘草片r","album":"Free Loop"}`。浏览器收到 `{"status":true,"result":"ok"}`。页面随后使用曲目对象内的限时 NetEase 音频 URL（本次为 `m8.music.126.net` 的 FLAC）播放或触发下载。接口授权响应本身不是音频文件。

本地 Node 重放这些请求时同样被 Cloudflare 返回 403。项目不伪造浏览器 TLS 指纹、不复制个人 Cookie，也不自动解验证码。需要公司测试出口/IP 白名单或官方测试环境，才能让服务端直连方式稳定通过挑战。

## 已封装接口

服务端按抓到的路由、请求体、常见浏览器请求头及站点 Referer 发起请求。浏览器 UA 字符串不会让 Node TLS 客户端变成真实 Chrome；上游可以据此继续拒绝请求。

- `POST /api/music/search`：`{"source":"pixabay","query":"轻快"}`，请求 Pixabay HTML 并解析曲目卡片；或 `{"source":"24bit","query":"轻快","page":1}`，并行重放 24bit 的三个 POST，保留两路原始 JSON 响应。
- `POST /api/music/pixabay/detail`：`{"detailUrl":"https://pixabay.com/zh/music/<slug-id>/"}`，读取详情页并解析标题、作者和 CDN MP3 地址。
- `POST /api/music/pixabay/download`：`{"url":"https://cdn.pixabay.com/download/audio/...mp3?filename=...mp3"}`，返回 MP3 二进制，限 25 MB。
- `POST /api/music/24bit/download`：`{"detailUrl":"https://www.24bit.net/music/c/<id>","track":{"type":"c","name":"Free Loop","player":"甘草片r","album":"Free Loop"},"audioUrl":"https://m8.music.126.net/...flac"}`。先重放下载授权 POST，只有授权成功才请求并返回曲目音频，限 200 MB。只允许 24bit 官方曲目详情页和 `m<number>.music.126.net` 音频地址。

上游错误使用 HTTP 502 和 `{error,code,source,upstreamStatus?}`；输入错误使用 HTTP 400。`UPSTREAM_CHALLENGE` 表示需调整测试网络授权或由站点提供可用测试环境，不应通过绕过挑战处理。

## 调用链验证

用 `scripts/test-music-api-flow.mjs` 按调用方方式依次请求本地 API；通过 `QINGJIAN_API_BASE` 指定轻剪 API 根地址。脚本只在内存计数和检查下载响应，不保存音频。当前验证结果：Pixabay 搜索和详情均停在 `502 UPSTREAM_CHALLENGE`，但使用已抓包确认的曲目 CDN 地址调用下载接口成功，返回 `200 audio/mpeg`、1,712,796 字节；24bit 在搜索阶段返回相同挑战错误。两站的“搜索→下载”全流程当前均为 incomplete，不能宣称已跑通。

## 真实浏览器凭据对照

随后在已打开的 24bit Chrome 原站页内用 `fetch` 重放同一搜索请求：默认同源凭据 (`credentials: include`) 下 `searchOnlineMusicOne`、`searchOnlineMusicTwo` 和 `setKeyword` 都返回 HTTP 200；两路各有 30 首，结果结构为 `{status,result:[{id,cover,name,player,album}]}`。将同一请求设为 `credentials: omit` 后立即得到 HTTP 403、`cf-mitigated: challenge`。对应 Cloudflare Ray ID：omit 请求 `a40f11ab980addfc-SIN`，include 请求 `a40f11ad4cdefd3f-SIN`。没有读取或导出 Cookie 值。该对照表明当前差异至少与 Chrome 会话里的站点状态有关，单补 User-Agent/Referer 不够。

从 `searchOnlineMusicOne` 首条结果继续在 Chrome 内请求 `/music/c/<id>`，详情 HTTP 200 并包含音频地址；调用 `/api/music/getOnlineDownload` 返回 `{"status":true,"result":"ok"}`。音频 Range 请求返回 HTTP 206。随后在浏览器里完整读取该响应流，HTTP 200、`audio/mpeg`，声明和实际读取均为 91,843,646 字节；只计数验证，没有保存音频文件。因此**真实 Chrome 会话代码请求完成了 24bit 搜索→详情→授权→完整音频流读取**；同一流程在当前 Node 服务端仍于搜索阶段被拦截。

新增 [浏览器上下文方法库](../scripts/music-browser-client.js)，它必须在目标站点自身页面运行，让 Chrome 自动附带同源会话状态；代码不访问 `document.cookie`。当前 CUA 安全策略拒绝将本地 JS 文件加载到第三方网站页面，因此本次完整链路验证使用的是等价的内联浏览器请求，未声称该本地文件本身已在页面中执行。若集成方需要纯服务端 API，则由站点维护方按测试服务出口和确切 API 路径配置白名单/例外；Cloudflare 官方支持受限 IP allowlist 和 Custom Rule Skip，但 Bot Fight Mode 不能通过普通 Skip 规则绕过，需由 zone 管理员按实际命中产品选择配置： [IP allowlist](https://developers.cloudflare.com/waf/custom-rules/use-cases/allow-traffic-from-ips-in-allowlist/)、[Skip 支持范围](https://developers.cloudflare.com/waf/custom-rules/skip/options/)、[Bot Fight Mode 限制](https://developers.cloudflare.com/bots/get-started/bot-fight-mode/)。

加载该方法库到对应原站页面后，24bit 调用示例：

```js
const result = await window.qingjianMusicBrowser.search24bit('轻快');
const download = await window.qingjianMusicBrowser.get24bitDownload(result.one[0]);
await window.qingjianMusicBrowser.saveDownload(download);
```

Pixabay 调用示例：

```js
const result = await window.qingjianMusicBrowser.searchPixabay('轻快');
const track = await window.qingjianMusicBrowser.getPixabayTrack(result.tracks[0].detailUrl);
const download = await window.qingjianMusicBrowser.getPixabayDownload(track);
await window.qingjianMusicBrowser.saveDownload(download);
```

Pixabay 的[官方 API 文档](https://pixabay.com/api/docs/)列出图片与视频接口，没有音乐搜索 API；这里实现的是网页请求复现，不是官方开放 API。下载成功也不替代对站点接口和具体曲目授权范围的核对。
