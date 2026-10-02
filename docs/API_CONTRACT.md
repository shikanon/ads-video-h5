# 轻剪前后端契约

所有接口使用同源 `/api`（远端测试部署使用 `/qingjian/api`），JSON 错误统一为 `{ "error": "可读的中文错误" }`。浏览器只接收 `PublicModel`，不能获得 API Key。公共类型见 `src/types.ts`。当 `OSS_PUBLIC_READ=true` 时，`AppState` 中的素材、产物、封面、分镜缩略图预览 URL 为可匿名访问的新加坡 OSS HTTPS 直链；`downloadUrl` 仍为应用内接口。

教学主题可在无附件的新会话直接生成视频，一般教学默认180秒横屏，从浅入深/变迁史默认240秒，详见[教学流程](TEACHING_WORKFLOW.md)。`Session.lessonDraft` 保存已核查脚本，`EditPlan.lesson` 保存逐章目标、旁白、引用、图解数据及音视频证据；`Job.workflow` / `Artifact.workflow` 保存脱敏工具输入、输出、调用标识与耗时，供页面折叠查看及制作记录导出。

| 方法与路径 | 请求 | 响应/行为 |
| --- | --- | --- |
| `GET /api/health` | 无 | 无敏感信息的服务健康状态 |
| `GET /api/auth/me` | Cookie | 当前帐号资料；未登录返回 401 |
| `POST /api/auth/send-code` | `{email}` | 通过 Resend 发送 6 位注册验证码；有效期 10 分钟，至少间隔 60 秒重发 |
| `POST /api/auth/register` | `{displayName,email,password,verificationCode}` | 校验邮箱验证码后创建帐号并设置登录 Cookie |
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
| `POST /api/media/:id/analyze` | `{}` | 创建或复用当前帐号的原声音频理解任务，返回 `AppState` |
| `GET /api/media/:id/transcript` | 无 | 下载已完成的 `AudioAnalysis` JSON，未分析返回错误 |
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
| `GET /api/effects` | 无 | 已启用 HTML 特效的名称、说明、画幅和时长，不返回源码 |

音乐接口使用本次浏览器抓到的路由、请求体及常见浏览器头重放，不会复用个人 Cookie 或绕过 Cloudflare。上游拒绝时返回可识别的错误；见 [抓包记录及限制](BGM_SOURCE_RESEARCH.md)。

除健康状态、注册、登录与登录状态查询外，普通 `/api` 接口都要求登录 Cookie。会话、素材、任务、成片及其应用内文件接口按帐号校验归属；跨帐号 ID 返回 404。公开读 OSS 直链是独立访问路径，持有链接的人无需 Cookie 即可读取对象。服务端拒绝来源不符的跨站写请求。管理后台继续使用独立管理员令牌，不使用普通帐号 Cookie。

需要复用测试浏览器会话时，使用 `scripts/music-browser-client.js` 中的 `window.qingjianMusicBrowser` 方法，并在对应站点原页面上下文运行；`fetch` 由 Chrome 自动附带同源凭据，脚本不读取 Cookie。服务端 `/api/music/*` 与浏览器上下文方法是两条不同传输路径，当前网络仅浏览器会话路径已完成 24bit 的搜索到音频流读取验证。

管理后台 API 使用 `/api/admin` 前缀，凭本地管理员令牌访问。模型配置项包含 `id/name/provider/kind/modelId/baseUrl/enabled/apiKey`，读取时只返回密钥是否已设置与掩码，永不回传完整密钥。
HTML 特效的管理、草稿预览、渲染和下载接口见 [HTML 特效说明](HTML_EFFECTS.md)；普通对话输入特效指令后仍走 `/api/chat` 异步任务，返回视频产物与素材。

原声音频理解任务为 `understanding`，成片重审为 `review`。`MediaItem.analysis` 包含源内容哈希、模型、逐字稿、完整/残句、字词起止秒、低音量停顿及字幕语义分行索引；`timing=model-estimated`。`EditPlan` 可表达 `fineCut`、片段 `sentenceIds/purpose/zoom/volume/transition`、`captions/overlays` 及 `audio` 的三路音量和响度归一化。语义字幕分行只返回字词索引，文字与时间仍从源字词映射。

视频产物保存实际使用的 `plan`、`planHash` 和 `review`（逐项检查、自动评分、语义建议、限制）。模型失败或检查不通过标为 `needs-review`；纯导出请求复用方案，修改请求先重新规划。自动返修最多一次，仅接受检查及评分不变差的结果。音频理解模型种类为 `understanding`，当前要求 `doubao-seed-2-1-lite-260915`，配置密钥不进入前端。

精剪与叙事请求使用实际 Pi 工具链：`transcribe_sources → read_transcript → select_scenes → inspect_scenes → write_narrative → arrange_timeline → render_edit → review_edit`。只规划时停在编排；明确导出当前方案时仅渲染和审查。`Job.stage/workflow` 保存各阶段成功或失败，失败不伪装为完成；修改分镜或脚本会使旧渲染失效。

检索一次返回单素材最多30句，空查询分页，多关键词按任一关键词命中。跳句选集自动拆为连续原句分镜，之后脚本须引用实际返回编号。`select_scenes` 另用理解模型结合前后原句核验独立完整性，防止上游 complete 标记把重录残句误当完整句。时间线返回摘要而非重复整份逐字稿；精剪执行请求使用必选工具调用和明确的下一阶段提示。返修失败时保留已渲染、已审查版本及问题，不丢失有效成片。

已准备的下一阶段采用 `tool_choice` 指定函数，工具失败后允许回退修改；能力依据见[方舟 Chat API](https://docs.volcengine.com/docs/ark/chat-api?lang=zh&redirect=1)。260915 Seed 2.1 Pro/Lite 在 Pi 适配器使用1,024,000上下文预算，最大输出分别262,144与256,000；Pro 的最大输出参数已通过实际 Chat API 请求。原32K声明会令长工具链后期输出被夹到1 token。输出上限与上下文窗口分别配置，SDK仍按剩余上下文限制输出；低于1024输出token时明确中止，不继续空响应循环。

`EditPlan.editorial.scenes` 保留真实原话、源起止秒、句子ID、素材哈希、选择理由和三帧构图观察；`editorial.script` 保存主题、受众、叙事弧、风格和有序分镜。编排工具只按已验证句子派生源剪点。`motions` 绑定分镜与成片时间，限定圈注、划线、因果箭头和步骤路径，由已有 QJMotion/GSAP 经 HyperFrames 子合成渲染透明 WebM，再合成进实际视频。用户原话或标签不能作为 HTML/JavaScript 执行。

`GET /api/artifacts/:id/edit-report` 在当前帐号权限范围内下载成片的方案、脚本、分镜证据、工具执行记录和审查 JSON。审查使用完整音频与最多18张关键抽帧（分镜中段、绘制早期和稳定阶段），另核验渲染清单、方案哈希、字幕时间映射和原话证据。它是有范围限制的自动审查，不等于逐帧人工审片；语义模型未完成时该部分不给分。

审查分数取内容语义分与技术通过比例分中的较低者，技术项全过不能提高内容评分；语义审查失败给0分并标需复核。多于18个候选抽帧时在全片候选时间中均匀采样，包含结尾。绘制标签按实际字符宽度估算缩小字号，减少单字换行。

字幕分行在源字词边界上再核验中文词边界，若模型把“效果”拆成“效/果”，延后到完整词结束再换行，保持原文与源时间不变。明确保留当前分镜的局部字幕修改可载入既有分镜和叙事，重新编排、更新版本、再渲染审查；不重新选择原话。审查将实际混音输入与真实剪切边界提供给理解模型，未启用的 BGM 音量不是新增音乐；单独重审也继续携带该成片原始制作要求。

重构知识短片请求自动导出，工具链增加 `research_gaps/write_rebuilt_script/prepare_voice/produce_scenes/repair_scenes`。`EditPlan.reconstruction`记录缺口、搜索引用、原声与新增混合脚本、参考音频哈希和实测时长。新增视频素材的 `generation`记录工作流、分镜、台词、音频、HTML及原声来源哈希；时间线校验完整源句、所有生成音轨范围与声音参考。渲染清单区分整片旁白与分镜内新增配音。原声与新增都从实际音频转写生成字幕，不用预期台词伪造字幕。参见[重构工作流](NARRATIVE_REBUILD.md)。

`RenderReview.audio` 保存逐段实测LUFS、真峰值、有声窗P90−P10、相邻段综合差和头尾瞬时差、音色审听结果及 `userReportedMismatch`。声音检查独立决定 `needs-review`，整片平均响度或参考哈希不能代替逐段验证。`MediaItem.generation.voiceRejectedAudioHash` 将用户的音色拒绝关联到具体音频；重合成递增分镜 `voiceRevision` 使旧TTS缓存失效，实际新声音仍须再次审听。

### 分段 Agent 回复

`ChatMessage.parts` 为可选数组，每项含 `id`、`phase: commentary | final`、`text`、`createdAt`。同一个请求使用同一 `jobId` 的 assistant 消息，过程部分按稳定 id 更新，最后增加 final 部分。`ChatMessage.text` 仅保存最终总结，兼容旧客户端并用于后续模型上下文；过程段落不重新作为指令送入模型。

任务运行时客户端通过现有任务/状态刷新显示增量段落。完成状态决定自动折叠，失败时也显示最终结果与重试按钮。无 parts 的历史消息按旧格式读取，长文本支持展开原文。
### 热点研究

热点选题仍通过现有消息接口提交，`plan` 任务在无视频生产请求时只执行研究。`ChatMessage.research` 保存选题钩子、角度、视觉建议、原文摘录、来源、发布日期、榜单观察时间与失败记录。明确的热点视频请求进入 HTML 图解工作流；`LessonReport.hotResearch` 保存资料快照，实际渲染前与审查时核验时效。工具记录显示 `discover_hot_topics/select_hot_topics/search_news/read_news_sources/propose_hot_brief`；研究失败或无合格新稿不会伪造选题。参见 [热点研究](HOT_RESEARCH.md)。
