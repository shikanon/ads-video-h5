# 轻剪服务端部署

域名 `https://video.shikanon.com/` 由 Nginx 转发到本机 `127.0.0.1:8787`；原 IP 入口 `https://101.47.18.93/qingjian/` 继续可用，IP 的 `/` 仍属于服务器原有服务。域名首页公开展示 Landing，工作区与素材 API 需要轻剪帐号密码登录；管理后台继续需要独立管理员令牌。IP 预览入口可继续使用 Nginx Basic Auth。

## 目录与服务

- 代码：`/opt/ads-video-h5`
- 持久数据：`/data/qingjian`（帐号密码哈希与登录会话、管理员令牌、加密模型配置、素材、成片）
- 私有对象存储：阿里云 OSS 北京地域 `qingjian-shikanon-media-2026`；素材和产物以帐号 ID 分目录保存，服务端鉴权后代理访问，`/data/qingjian` 保留处理缓存和状态。
- systemd：`qingjian.service`
- Nginx：`/etc/nginx/sites-enabled/video-posttrain-lab` 中的 `/qingjian/` 路由
- 域名站点：[`ops/nginx/video.shikanon.com.conf`](../ops/nginx/video.shikanon.com.conf) 安装为 `/etc/nginx/sites-enabled/qingjian-domain`，不改动 IP 站点
- 域名证书：`/etc/letsencrypt/live/video.shikanon.com/`，由服务器现有 `vpl-cert-renew.timer` 续期并在成功续期后重载 Nginx

服务只监听 loopback，不直接开放 8787。`PUBLIC_BASE_PATH=/qingjian` 为 API 返回的素材与成片链接加前缀，`VITE_BASE_PATH=/qingjian/` 控制构建产物的资源路径。

域名 DNS 的 A 记录指向 `101.47.18.93`。HTTP 的 `/.well-known/acme-challenge/` 从 `/var/www/acme` 提供证书验证，其余 HTTP 请求跳转到 HTTPS。域名专用 HTTPS server block 对公众开放 Landing 与帐号入口；根路径只显示轻剪，`/qingjian/` 保持资源和 API 路径。更新 Nginx 前先备份现有配置并执行 `nginx -t`，成功后再 `systemctl reload nginx`；检查证书 SAN、域名根路径、登录状态、受保护 API、原 IP 入口及原有站点。

## 更新

在服务器上确认 Git SHA 后，执行 `git fetch`、切换到目标 SHA、`pnpm install --frozen-lockfile`、`VITE_BASE_PATH=/qingjian/ pnpm build`，再 `systemctl restart qingjian`。更新后检查 `systemctl status qingjian`、`curl http://127.0.0.1:8787/api/health`，并确认未登录的 `/qingjian/api/state` 返回 401。不要把 `/data/qingjian` 放进 Git，也不要在日志里打印 API Key 或临时密码。

### 自动部署（CD）

服务器使用 `qingjian-cd.timer` 每分钟检查公开仓库的 `origin/main`，由 root 拥有的 `/usr/local/sbin/qingjian-cd` 执行部署。脚本只接受当前部署提交的快进更新，先把目标提交解包到临时目录，再用无权读取 `/data/qingjian` 的 `qingjian-build` 用户安装依赖并构建。构建成功后切换源码、`dist/` 和 `node_modules/`，重启服务并检查本机 API 与 H5；失败时一并恢复先前提交、静态产物和依赖。模型密钥、素材和成片始终留在 `/data/qingjian`。这条链路不需要把服务器密码或 SSH 私钥放进 GitHub Secrets。

安装文件位于 [`ops/cd`](../ops/cd/)。首次安装在服务器上创建 `qingjian-build` 系统用户和 `/var/cache/qingjian-cd/home`，将脚本以 `root:root 0755` 安装到 `/usr/local/sbin/qingjian-cd`，将 service/timer 以 `root:root 0644` 安装到 `/etc/systemd/system/`，然后执行 `systemctl daemon-reload`、`systemctl enable --now qingjian-cd.timer`。可用 `systemctl start qingjian-cd.service` 立即执行一次，并通过 `journalctl -u qingjian-cd.service`、`git -C /opt/ads-video-h5 rev-parse HEAD` 和 `curl http://127.0.0.1:8787/api/health` 验证。定时器状态可用 `systemctl list-timers qingjian-cd.timer` 查看。

### 旧数据归属

升级前备份 `/data/qingjian/app-state.json` 与 `/data/qingjian/auth.json`（若存在）。停止轻剪服务后运行 `QINGJIAN_DATA_DIR=/data/qingjian pnpm tsx scripts/provision-owner.ts <邮箱>`，脚本只认领尚未归属帐号的旧数据；若邮箱尚未注册，将输出一次性初始密码，用户登录后在用户中心修改。此操作必须在公开域名注册入口前完成，运行后调整数据文件属主为 `qingjian` 并重新启动服务。不要把临时密码写入代码、仓库、部署日志或工单。

CD 脚本的运行副本由 root 拥有，仓库推送不会自动更改脚本或 systemd 单元；更新部署机制时需单独重新安装这些文件。线上代码或定时器应由服务器管理员维护，不要让 Web 服务进程写入 `/opt/ads-video-h5`。

### OSS 私有配置与迁移

本机将 `OSS_ACCESS_KEY_ID`、`OSS_ACCESS_KEY_SECRET`、`OSS_REGION`、`OSS_BUCKET`、`OSS_PREFIX` 放入被 Git 忽略的 `data/oss.env`（权限 `0600`）。服务器使用 `/etc/qingjian/oss.env`（`root:root 0600`），内容同名；通过 [`ops/cd/qingjian-oss.conf`](../ops/cd/qingjian-oss.conf) 为 `qingjian.service` 配置 systemd drop-in，同时安装新版 [`qingjian-cd.service`](../ops/cd/qingjian-cd.service) 让 CD 读取同一环境文件。CD 构建子进程使用清空后的环境，仅传入 PATH/HOME/缓存路径，不向依赖安装和前端构建传递 OSS 密钥。不要把密钥写入仓库、GitHub Actions 或 Vite 的 `VITE_` 变量。

部署新代码前备份 `/data/qingjian`，检查 `media/`、`artifacts/`、`exports/` 的大小；在旧文件仍在本地时运行 `QINGJIAN_DATA_DIR=/data/qingjian pnpm tsx scripts/sync-oss.ts`，输出 `missing:0` 才视为迁移完成。脚本幂等，已在 Bucket 中的对象跳过。升级后测试上传、预览、剪辑导出、下载，并验证对象已进入 Bucket；运行时本地缓存缺失会从 OSS 恢复。Bucket 应保持私有，禁止公共读取。API Key 应仅由服务端环境读取。

`docs/test.mp4` 是本地验收素材，已从 Git 排除；测试时单独上传。切镜点使用 FFmpeg 的画面变化阈值，最多展示 8 段，并不分析人物或事件语义。内置配乐是确定性合成音，正式创作可上传自己的音乐素材。
