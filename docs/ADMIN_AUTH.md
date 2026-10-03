# 管理员账号与 Authenticator

后台与手机端用户使用独立身份。默认管理员账号固定为 `admin`，没有公开的固定初始密码，也没有管理员自助注册入口。

## 首次登录与升级

首次启动 API 时初始化服务端数据目录（默认 `data/`，线上 `/data/qingjian`）中的管理员身份。初始密码按以下顺序选择：

1. 首次启动时的服务器私有环境变量 `QINGJIAN_ADMIN_PASSWORD`，12–256 位。
2. 已有 `admin-token` 文件的值，作为旧实例升级的一次性初始密码。
3. 自动生成的高强度随机密码。

一次性初始密码写入数据目录的 `admin-initial-password`（权限 `0600`），部署管理员应在服务器本地读取，再通过 HTTPS 后台页面登录。首次登录只能访问账号安全页，必须设置至少 12 位新密码才可管理模型、特效或评测。修改后初始密码文件删除，初始密码失效。初始化完成后，修改环境变量不会重置已有账号。

旧 `admin-token` 保留作为已有模型配置的加密材料，**不再是管理 API 的登录凭证**。不要删除或修改它，否则已有模型 API Key 无法解密。前端会移除旧管理员令牌缓存，改用登录返回的 8 小时短期会话。普通轻剪用户 Cookie 不具备管理权限。

## 绑定动态验证码

在「账号安全」验证当前密码，生成二维码，用 Google Authenticator、Microsoft Authenticator 或兼容的 TOTP 应用扫码；不能扫码时可展开手动密钥。二维码由本机 QRCode 库生成，不发送到第三方二维码服务。绑定准备有效期 10 分钟，必须输入真实有效的动态验证码后才启用。

协议使用 [RFC 6238](https://www.rfc-editor.org/rfc/rfc6238) TOTP，SHA-1、6 位、30 秒时间步；二维码采用 [Authenticator Key URI](https://github.com/google/google-authenticator/wiki/Key-Uri-Format) 格式。服务器接受当前时间步及前后一个时间步，拒绝已消费的验证码；刚完成绑定或另一处登录后，需等待应用显示下一个验证码。手机与服务器应保持自动校时。

绑定后，账号密码验证只签发 5 分钟登录挑战，不授予管理权限；还须提交动态验证码或一次性恢复码才取得会话。挑战绑定发起 IP，验证最多尝试 5 次，之后需要重新输入账号密码。失败验证还受每 IP / 全账号的 15 分钟限制。

## 恢复、修改与退出

成功绑定会显示 8 个恢复码，仅本次显示，可下载到自己安全保管的位置。服务端只保存恢复码 SHA-256 哈希；每个码只能使用一次。恢复码登录不自动关闭 Authenticator，可在登录后验证密码与剩余恢复码来更换设备。

修改密码、关闭动态验证码、重新生成恢复码均重新验证当前密码；已启用 Authenticator 时还必须验证动态验证码或恢复码。操作成功后撤销其他所有管理会话，仅保留操作方的新会话。重新生成恢复码使旧码全部失效；关闭 Authenticator 后恢复码也失效。退出登录立即撤销当前会话，关闭标签页不会撤销其他设备的会话。

丢失手机且无恢复码时，由服务器管理员恢复有效备份并处理身份恢复；没有提供未经验证的网页重置入口。不要通过删除管理员数据来当作常规密码重置。

## 持久化和备份

以下文件位于私有服务端数据目录，不随构建产物发布，也不进入 Git：

| 文件 | 内容 |
| --- | --- |
| `admin-auth.json` | scrypt 密码哈希、加密 TOTP 密钥、已消费时间步、恢复码哈希、会话哈希及有效期 |
| `admin-auth-key` | 随机 256 位 AES-GCM 加密密钥，必须与 `admin-auth.json` 一起备份 |
| `admin-initial-password` | 首次初始化的临时密码，改密后删除 |
| `admin-token` + `provider-models.json` | 已有模型密钥的加密材料与配置，继续配套备份 |

管理员身份文件权限为 `0600`。API 响应设置 `Cache-Control: no-store`；错误和普通身份读取不包含密码、TOTP 密钥或恢复码。写操作串行执行并原子保存，防止并发重用同一个验证码或恢复码。身份更改后未保存成功不会签发成功结果。

## API

成功登录返回 `{token, expiresAt, account}`。后续请求使用 `Authorization: Bearer <token>`；`token` 是登录会话，不是历史长期管理员令牌。`account` 为 `{username,mustChangePassword,totpEnabled,recoveryCodesRemaining}`。

| 接口 | 输入 | 行为 |
| --- | --- | --- |
| `POST /api/admin/auth/login` | `{username,password}` | 未绑定时返回会话；已绑定时仅返回 `{requiresTotp:true,challenge,expiresAt}` |
| `POST /api/admin/auth/login/totp` | `{challenge,code}` | 消费动态验证码或恢复码后签发会话；恢复码登录含 `usedRecoveryCode:true` |
| `GET /api/admin/auth/session` | Bearer 会话 | 读取公开账号状态，允许首次改密前使用 |
| `POST /api/admin/auth/logout` | Bearer 会话 | 撤销当前会话 |
| `PUT /api/admin/auth/password` | `{password,newPassword,code?}` | 当前密码 + 已绑定时的动态验证码/恢复码；轮换会话 |
| `POST /api/admin/auth/totp/setup` | `{password}` | 重新验证密码，返回 `{secret,qrDataUrl,expiresAt}`，尚未启用 |
| `POST /api/admin/auth/totp/enable` | `{code}` | 验证同一会话的绑定码后启用，返回新会话与一次性 `recoveryCodes` |
| `POST /api/admin/auth/totp/disable` | `{password,code}` | 双因素验证后关闭，轮换会话 |
| `POST /api/admin/auth/recovery-codes` | `{password,code}` | 双因素验证后生成新恢复码，轮换会话 |

所有模型、特效、渲染下载和评测接口共享同一管理员会话中间件。未登录或会话过期为 `401 ADMIN_UNAUTHORIZED`；初始密码未修改为 `403 ADMIN_PASSWORD_CHANGE_REQUIRED`。前端收到当前会话的失效响应后返回登录；旧会话的迟到响应不会清空已经轮换的新会话。

命令行特效渲染脚本同样要求短期会话，可通过私有环境变量 `QINGJIAN_ADMIN_SESSION` 或 `QINGJIAN_ADMIN_SESSION_FILE` 指定 `0600` 会话文件；默认读取数据目录的 `admin-session`。该文件不自动生成，也不是新的永久访问凭证。自动化不能读取 TOTP 密钥或复用模型加密文件来绕过动态验证码。Agent 内置特效工具在已登录用户的任务执行链中直接调用同进程存储。

自动回归：`pnpm exec tsx --test tests/adminAuth.test.ts`，覆盖 RFC 标准向量、迁移隔离、实际 QR PNG、双因素登录、并发重放、过期、恢复码、会话撤销及验证限流。
