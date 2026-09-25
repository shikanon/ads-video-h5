# 轻剪前后端契约

所有接口使用同源 `/api`（远端测试部署使用 `/qingjian/api`），JSON 错误统一为 `{ "error": "可读的中文错误" }`。浏览器只接收 `PublicModel`，不能获得 API Key。公共类型见 `src/types.ts`。

| 方法与路径 | 请求 | 响应/行为 |
| --- | --- | --- |
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
| `PATCH /api/settings` | `Partial<AppSettings>` | `AppState`，默认模型/语言/聊天背景 |

管理后台 API 使用 `/api/admin` 前缀，凭本地管理员令牌访问。模型配置项包含 `id/name/provider/kind/modelId/baseUrl/enabled/apiKey`，读取时只返回密钥是否已设置与掩码，永不回传完整密钥。
