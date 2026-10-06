# 国内测试服务部署

域名为 `video.tensorbytes.com`，服务器为阿里云 `8.134.24.116`。SSH 私钥只在操作者本机使用，不复制到服务器或仓库。

## 单机布局

- Node 24.21.0：`/opt/qingjian-cn/node`，独立于服务器原有 Node 和其他应用。
- pnpm 11.25.0：`/opt/qingjian-cn/pnpm/node_modules/.bin/pnpm`。
- 不可变源码与构建：`/opt/qingjian-cn/releases/<40位Git提交号>`；`current` 为当前版本软链接。
- 运行用户 `qingjian-cn`，构建用户 `qingjian-cn-build`；运行进程只监听 `127.0.0.1:8787`。
- 持久数据 `/data/qingjian-cn`；配置和模型密钥不进入源码包，构建用户不能读取此目录。
- `qingjian-cn.service` 为运行服务；`/etc/qingjian-cn/server.env` 可存放服务器私有设置。
- Nginx 仅新增 `video.tensorbytes.com` 专用站点；证书位于 `/etc/letsencrypt/live/video.tensorbytes.com`。

国内 H5 与小程序使用同一服务和数据目录。海外 H5 的历史账号、积分和任务是否迁移需单独确认；两个运行实例不能直接共写 JSON 数据文件，也不能用周期复制冒充实时共用。

## 安装与激活

1. 创建两个系统用户、独立目录，安装 Node 与仓库指定的 pnpm；Node 下载包按官方 SHA-256 核验。已存在的应用、运行时及 Nginx 站点不覆盖。
2. 用 `git archive <sha>` 导出已提交版本并上传，核对包哈希；`ops/release-revision.txt` 的 `export-subst` 将提交号带入构建源。
3. 在独立目录以构建用户执行 `pnpm install --frozen-lockfile` 和 `VITE_BASE_PATH=/qingjian/ pnpm build`。环境不传入模型、OSS、邮件密钥，构建后将发布目录改为 root 拥有、只读。
4. 将轻剪现有的加密 `provider-models.json` 和匹配的 `admin-token` 放入持久目录，权限 `0600`。它们只用于服务端模型配置；管理员登录采用独立密码。`oss.env`、`resend.env` 也放在该私有目录，由服务端加载。不要复制其他应用的凭证或测试账号数据。
5. 将 [`qingjian-cn.service`](qingjian-cn.service) 和 [`activate-release`](activate-release) 安装到 systemd 与 `/usr/local/sbin/qingjian-cn-activate`。执行 `systemctl daemon-reload` 后，运行 `qingjian-cn-activate /opt/qingjian-cn/releases/<sha>`；脚本检查发布号、H5、后台和未登录 401，失败恢复前一版本。
6. 先配置 HTTP ACME 验证站点，再用服务器现有 Certbot 账号获取本域名证书。安装 [`video.tensorbytes.com.conf`](../nginx/video.tensorbytes.com.conf)，执行 `nginx -t` 后重载。证书自动续期后需 nginx reload hook。
7. 从公网检查 `/qingjian/api/health` 的实际 SHA、`/qingjian/release.json`、未登录状态 401，再使用隔离验收账号验证签到、上传、原生识别和 Agent。检查原有站点仍健康。

服务配置变更不由代码推送自动安装；本部署不启用海外站点的 CD 定时器。更新时重复导出、构建、校验和激活步骤，保留旧版本供回滚，不替换持久数据目录。

服务器内存较小时，安装依赖先使用 `NODE_OPTIONS=--max-old-space-size=384 pnpm install --frozen-lockfile --network-concurrency=2 --child-concurrency=1`，构建单独执行并观察内存。安装过程连接中断时先核查原进程和服务器负载，再决定续装；不要同时启动重复安装或重启整台共享服务器。

## 原生接口验收脚本

[`tooling/smoke-miniprogram.mjs`](../../tooling/smoke-miniprogram.mjs) 使用实际原生客户端的网络封装与公网 API，覆盖发布 SHA、鉴权、同国内 H5 会话同步、签到去重、PNG/MP4/MP3 二进制上传与私有下载、真实 Agent 视频导出和全帧解码。启用语音选项还会用测试文本生成语音，先识别，再提交同一任务；它不是微信设备模拟器。

管理员须先在隔离测试环境准备专用账号。凭证 JSON 仅保存在服务器私有目录，含 `purpose: "qingjian-deployment-qa"`、以 `mini-deploy-` 开头且以 `@example.invalid` 结尾的测试邮箱，以及至少 24 位随机密码。脚本拒绝使用普通生产账号，不会打印凭证或登录 Cookie。以下命令只引用文件路径，不包含密钥值：

```bash
cd /opt/qingjian-cn/current
QINGJIAN_DATA_DIR=/data/qingjian-cn \
QINGJIAN_MINI_QA_CREDENTIALS=/data/qingjian-cn/deploy-qa-credentials.json \
QINGJIAN_MINI_QA_REPORT=/data/qingjian-cn/deploy-qa-report.json \
QINGJIAN_MINI_QA_VOICE=1 \
/opt/qingjian-cn/node/bin/node --import tsx tooling/smoke-miniprogram.mjs
```

合成测试素材及识别、生成请求会产生正常的模型和存储用量。测试报告必须依据真实执行结果，不能将脚本存在或本地专项测试通过写成线上验收通过。

本次操作状态见 [`DEPLOYMENT_20261006.md`](DEPLOYMENT_20261006.md)。

## 微信体验版

原生项目已绑定 `wxf5dfb5d144bcd684`。微信域名配置、开发者/体验者权限、隐私指引、开发者工具上传及设为体验版仍由发布者完成；服务器上线与代码包构建不代表微信体验版已发布。具体清单见 [`apps/miniprogram/README.md`](../../apps/miniprogram/README.md)。
