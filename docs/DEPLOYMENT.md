# 轻剪服务端部署

当前测试部署位于 `https://101.47.18.93/qingjian/`，由 Nginx 转发到本机 `127.0.0.1:8787`。`/` 仍属于服务器原有服务。轻剪的所有路径均在 `/qingjian/` 下；访问需要 Nginx Basic Auth，管理后台还需要独立管理员令牌。

## 目录与服务

- 代码：`/opt/ads-video-h5`
- 持久数据：`/data/qingjian`（管理员令牌、加密模型配置、素材、成片）
- systemd：`qingjian.service`
- Nginx：`/etc/nginx/sites-enabled/video-posttrain-lab` 中的 `/qingjian/` 路由

服务只监听 loopback，不直接开放 8787。`PUBLIC_BASE_PATH=/qingjian` 为 API 返回的素材与成片链接加前缀，`VITE_BASE_PATH=/qingjian/` 控制构建产物的资源路径。

## 更新

在服务器上确认 Git SHA 后，执行 `git fetch`、切换到目标 SHA、`pnpm install --frozen-lockfile`、`VITE_BASE_PATH=/qingjian/ pnpm build`，再 `systemctl restart qingjian`。更新后检查 `systemctl status qingjian`、`curl http://127.0.0.1:8787/api/state` 和经 Nginx 的 `/qingjian/api/state`。不要把 `/data/qingjian` 放进 Git，也不要在日志里打印 API Key。

### 自动部署（CD）

服务器使用 `qingjian-cd.timer` 每分钟检查公开仓库的 `origin/main`，由 root 拥有的 `/usr/local/sbin/qingjian-cd` 执行部署。脚本只接受当前部署提交的快进更新，先把目标提交解包到临时目录，再用无权读取 `/data/qingjian` 的 `qingjian-build` 用户安装依赖并构建。构建成功后才切换 `/opt/ads-video-h5`，重启服务并检查本机 API 与 H5；失败时恢复先前提交和 `dist/`。模型密钥、素材和成片始终留在 `/data/qingjian`。这条链路不需要把服务器密码或 SSH 私钥放进 GitHub Secrets。

安装文件位于 [`ops/cd`](../ops/cd/)。首次安装在服务器上创建 `qingjian-build` 系统用户和 `/var/cache/qingjian-cd/home`，将脚本以 `root:root 0755` 安装到 `/usr/local/sbin/qingjian-cd`，将 service/timer 以 `root:root 0644` 安装到 `/etc/systemd/system/`，然后执行 `systemctl daemon-reload`、`systemctl enable --now qingjian-cd.timer`。可用 `systemctl start qingjian-cd.service` 立即执行一次，并通过 `journalctl -u qingjian-cd.service`、`git -C /opt/ads-video-h5 rev-parse HEAD` 和 `curl http://127.0.0.1:8787/api/state` 验证。定时器状态可用 `systemctl list-timers qingjian-cd.timer` 查看。

CD 脚本的运行副本由 root 拥有，仓库推送不会自动更改脚本或 systemd 单元；更新部署机制时需单独重新安装这些文件。线上代码或定时器应由服务器管理员维护，不要让 Web 服务进程写入 `/opt/ads-video-h5`。

`docs/test.mp4` 是本地验收素材，已从 Git 排除；测试时单独上传。切镜点使用 FFmpeg 的画面变化阈值，最多展示 8 段，并不分析人物或事件语义。内置配乐是确定性合成音，正式创作可上传自己的音乐素材。
