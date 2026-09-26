# 轻剪前后端契约

所有接口使用同源 `/api`（远端测试部署使用 `/qingjian/api`），JSON 错误统一为 `{ "error": "可读的中文错误" }`。浏览器只接收 `PublicModel`，不能获得 API Key。公共类型见 `src/types.ts`。

| 方法与路径 | 请求 | 响应/行为 |
| --- | --- | --- |
| `GET /api/health` | 无 | 无敏感信息的服务健康状态 |
| `GET /api/auth/me` | Cookie | 当前帐号资料；未登录返回 401 |
| `POST /api/auth/register` | `{displayName,email,password}` | 创建帐号并设置登录 Cookie |
| `POST /api/auth/login` | `{email,password}` | 验证密码并设置登录 Cookie |
| `POST /api/auth/logout` | Cookie | 撤销当前登录会话并清除 Cookie |
| `PATCH /api/auth/password` | `{currentPassword,newPassword}` | 更新密码并撤销该帐号的其他会话 |
| `GET /api/state` | 无 | `AppState`，包含当前会话、素材、任务和成片 |
| `POST /api/sessions` | `{}` | `AppState`，创建并激活新对话 |
| `POST /api/sessions/:id/activate` | `{}` | `AppState`，切换历史会话 |
| `POST /api/chat` | `{sessionId, message, attachmentIds?}` | `AppState`，先持久化用户消息与异步任务，不等待耗时生成 |
| `POST /api/media` | `multipart/form-data`，字段 `files` | `AppState`，支持视频、图片和 MP3/WAV/OGG 音频；视频自动检测最多 8 段分镜 |
| `DELETE /api/media/:id` | 无 | `AppState`，删除素材前由前端提示关联影响 |
| `GET /api/media/:id` | 无 | 对应视频/图片/音频文件 |
| `GET /api/media/:id/shots/:index` | 无 | 该视频分镜的代表帧 JPEG |
| `GET /api/jobs/:id` | 无 | `Job`，客户端轮询任务状态后刷新 `/api/state` |
| `POST /api/jobs/:id/retry` | `{}` | `AppState`，失败任务重新入队 |
| `GET /api/artifacts/:id` | 无 | 生成图片、音频或视频文件 |
| `GET /api/download/:id` | 无 | 下载对应产物文件 |
| `POST /api/music/search` | `{"source":"pixabay"|"24bit","query":"轻快","page":1?}` | 直接请求站点网页流程；Pixabay 返回解析后的卡片（仅第 1 页），24bit 返回两路搜索 JSON 与关键词接口结果；上游挑战时返回 `502 UPSTREAM_CHALLENGE` |
| `POST /api/music/pixabay/detail` | `{"detailUrl":"https://pixabay.com/zh/music/<slug-id>/"}` | 从官方曲目详情页提取 MP3 CDN 地址和曲目信息 |
| `POST /api/music/pixabay/download` | `{"url":"https://cdn.pixabay.com/download/audio/...mp3?filename=...mp3"}` | 代理返回 MP3，最大 25 MB |
| `POST /api/music/24bit/download` | `{detailUrl,track:{type,name,player,album},audioUrl}` | 先调用 24bit 下载授权接口，再代理曲目页提供的 NetEase 音频，最大 200 MB |
| `PATCH /api/settings` | `Partial<AppSettings>` | `AppState`，默认模型/语言/聊天背景 |

音乐接口使用本次浏览器抓到的路由、请求体及常见浏览器头重放，不会复用个人 Cookie 或绕过 Cloudflare。上游拒绝时返回可识别的错误；见 [抓包记录及限制](BGM_SOURCE_RESEARCH.md)。

除健康状态、注册、登录与登录状态查询外，普通 `/api` 接口都要求登录 Cookie。会话、素材、任务、成片及其文件按帐号校验归属；跨帐号 ID 返回 404。服务端拒绝来源不符的跨站写请求。管理后台继续使用独立管理员令牌，不使用普通帐号 Cookie。

需要复用测试浏览器会话时，使用 `scripts/music-browser-client.js` 中的 `window.qingjianMusicBrowser` 方法，并在对应站点原页面上下文运行；`fetch` 由 Chrome 自动附带同源凭据，脚本不读取 Cookie。服务端 `/api/music/*` 与浏览器上下文方法是两条不同传输路径，当前网络仅浏览器会话路径已完成 24bit 的搜索到音频流读取验证。

管理后台 API 使用 `/api/admin` 前缀，凭本地管理员令牌访问。模型配置项包含 `id/name/provider/kind/modelId/baseUrl/enabled/apiKey`，读取时只返回密钥是否已设置与掩码，永不回传完整密钥。
