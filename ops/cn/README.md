# 国内测试服务部署

域名为 `video.tensorbytes.com`，服务器为阿里云 `8.134.24.116`。SSH 私钥只在操作者本机使用，不复制到服务器或仓库。

## 单机布局

- Node 24.21.0：`/opt/qingjian-cn/node`，独立于服务器原有 Node 和其他应用。
- pnpm 11.25.0：`/opt/qingjian-cn/pnpm/node_modules/.bin/pnpm`。
- 不可变源码与构建：`/opt/qingjian-cn/releases/<40位Git提交号>`；`current` 为当前版本软链接。
- 运行用户 `qingjian-cn`，构建用户 `qingjian-cn-build`；运行进程只监听 `127.0.0.1:8787`。
- 正式持久数据 `/data/qingjian`，运行用户主目录也使用此路径，兼容迁移数据的既有绝对文件路径；配置和模型密钥不进入源码包，构建用户不能读取此目录。
- `qingjian-cn.service` 为运行服务；`/etc/qingjian-cn/server.env` 可存放服务器私有设置。
- Nginx 仅新增 `video.tensorbytes.com` 专用站点；证书位于 `/etc/letsencrypt/live/video.tensorbytes.com`。

用户已确认原 H5 与小程序实时共用。国内 H5 与小程序使用同一服务和数据目录，原 H5 通过 HTTPS 网关访问国内后端；须执行 [`SHARED_DATA_CUTOVER.md`](SHARED_DATA_CUTOVER.md) 的历史迁移和共用验收。两个运行实例不能直接共写 JSON 数据文件，也不能用周期复制冒充实时共用。

## 安装与激活

1. 创建两个系统用户、独立目录，安装 Node 与仓库指定的 pnpm；Node 下载包按官方 SHA-256 核验。已存在的应用、运行时及 Nginx 站点不覆盖。
2. 用 `git archive <sha>` 导出已提交版本并上传，核对包哈希；`ops/release-revision.txt` 的 `export-subst` 将提交号带入构建源。
3. 安装 [`build-release`](build-release) 至 `/usr/local/libexec/qingjian-cn-build-release`，以构建用户在有资源限制的 systemd 临时单元中运行。它跳过依赖安装脚本，使用 Ubuntu 已有 FFmpeg，再验证 esbuild、构建 H5/后台并核对提交号。环境不传入模型、OSS、邮件密钥，构建后将发布目录改为 root 拥有、只读。
4. 按共用切换方案，从原生产服务的一致性快照迁移完整账号、账本、媒体和私有配置。`provider-models.json` 与匹配的 `admin-token`、管理员认证密钥保持 `0600`，OSS/邮件配置按原服务实际设置恢复。不要用本机开发数据替代生产快照，也不要只复制模型配置便公开空库。
5. 将 [`qingjian-cn.service`](qingjian-cn.service) 和 [`activate-release`](activate-release) 安装到 systemd 与 `/usr/local/sbin/qingjian-cn-activate`。执行 `systemctl daemon-reload` 后，运行 `qingjian-cn-activate /opt/qingjian-cn/releases/<sha>`；脚本先检查原账号、积分和会话 JSON 已导入且运行用户可读取解析，拒绝空库或不完整导入，再检查发布号、H5、后台和未登录 401，失败恢复前一版本。
6. 先配置 HTTP ACME 验证站点，再用服务器现有 Certbot 账号获取本域名证书。安装 [`video.tensorbytes.com.conf`](../nginx/video.tensorbytes.com.conf)，执行 `nginx -t` 后重载。证书自动续期后需 nginx reload hook。
7. 从公网检查 `/qingjian/api/health` 的实际 SHA、`/qingjian/release.json`、未登录状态 401，再使用隔离验收账号验证签到、上传、原生识别和 Agent。检查原有站点仍健康。

服务配置变更不由代码推送自动安装；本部署不启用海外站点的 CD 定时器。更新时重复导出、构建、校验和激活步骤，保留旧版本供回滚，不替换持久数据目录。

服务器内存较小时，构建 Node 堆限制为 384 MiB，安装并发为 2，禁止重复构建。当前国内服务器系统盘为 `/dev/vda`，临时构建单元使用 `MemoryHigh=450M`、`MemoryMax=640M`、`MemorySwapMax=0`、`CPUQuota=75%`，磁盘读写分别限制为 8 MiB/s、4 MiB/s 与各 200 IOPS，并设置 `OOMPolicy=kill` 和 15 分钟运行上限。这样即使构建超过限额，也只结束构建单元，保留 SSH 与原业务的资源。其他主机需先核对实际块设备再设置 I/O 限额。连接中断时先核查原进程和服务器负载，再决定续装；不要同时启动重复安装或重启整台共享服务器。

## 原生接口验收脚本

[`tooling/smoke-miniprogram.mjs`](../../tooling/smoke-miniprogram.mjs) 使用实际原生客户端网络封装和真实 HTTP，默认同时访问国内小程序 API 与原 `video.shikanon.com`。覆盖两入口发布 SHA、鉴权、同账号双向会话同步、跨入口签到去重、PNG/MP4/MP3 二进制上传与两入口私有下载、真实 Agent 视频导出、全帧解码和同步账本。启用语音选项还会用测试文本生成语音，先识别，再提交同一任务；它不是微信设备模拟器。切换前仅验收国内服务时可设 `QINGJIAN_MINI_QA_H5_ORIGIN=https://video.tensorbytes.com`，报告会明确标为国内单站测试，不能代替原 H5 共用验收。

管理员须先在隔离测试环境准备专用账号。凭证 JSON 仅保存在服务器私有目录，含 `purpose: "qingjian-deployment-qa"`、以 `mini-deploy-` 开头且以 `@example.invalid` 结尾的测试邮箱，以及至少 24 位随机密码。脚本拒绝使用普通生产账号，不会打印凭证或登录 Cookie。以下命令只引用文件路径，不包含密钥值：

```bash
cd /opt/qingjian-cn/current
QINGJIAN_DATA_DIR=/data/qingjian \
QINGJIAN_MINI_QA_CREDENTIALS=/data/qingjian/deploy-qa-credentials.json \
QINGJIAN_MINI_QA_REPORT=/data/qingjian/deploy-qa-report.json \
QINGJIAN_MINI_QA_VOICE=1 \
/opt/qingjian-cn/node/bin/node --import tsx tooling/smoke-miniprogram.mjs
```

合成测试素材及识别、生成请求会产生正常的模型和存储用量。测试报告必须依据真实执行结果，不能将脚本存在或本地专项测试通过写成线上验收通过。

本次操作状态见 [`DEPLOYMENT_20261006.md`](DEPLOYMENT_20261006.md)。

## 微信体验版

原生项目已绑定 `wxf5dfb5d144bcd684`。微信域名配置、开发者/体验者权限、隐私指引、开发者工具上传及设为体验版仍由发布者完成；服务器上线与代码包构建不代表微信体验版已发布。具体清单见 [`apps/miniprogram/README.md`](../../apps/miniprogram/README.md)。
