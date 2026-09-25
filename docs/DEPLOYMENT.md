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

`docs/test.mp4` 是本地验收素材，已从 Git 排除；测试时单独上传。切镜点使用 FFmpeg 的画面变化阈值，最多展示 8 段，并不分析人物或事件语义。内置配乐是确定性合成音，正式创作可上传自己的音乐素材。
