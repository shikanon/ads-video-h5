# 轻剪管理控制台

独立的 React + Vite 前端项目，不加载手机 H5 的入口、登录工作区或样式。模型管理、HTML 特效预览和 Agent 能力评测沿用 `/api/admin` 接口，使用独立管理员账号和短期会话鉴权。

默认账号为 `admin`，初始密码在服务端数据目录的 `admin-initial-password` 中，只供本地读取。首次登录必须改为至少 12 位密码，之后可在「账号安全」中扫码绑定 Google / Microsoft Authenticator。绑定后登录需要 6 位动态验证码，也可使用绑定时保存的一次性恢复码。登录会话有效期 8 小时，退出、修改密码或变更绑定会使相应会话失效。管理员身份与手机端用户账号完全独立。详见 [管理员账号与动态验证码](../../docs/ADMIN_AUTH.md)。

在仓库根目录执行 `pnpm install` 后：

```bash
pnpm dev:admin     # http://127.0.0.1:5174/，API 默认代理至 8787
pnpm build:admin   # 独立产物 apps/admin/dist/
```

也可在本项目内执行 `pnpm dev`、`pnpm build`。根目录 `pnpm dev` 会同时运行 H5、后台和 API；根目录 `pnpm build` 把独立产物打包到 `dist/admin/`，与 H5 一起进行原子发布和回滚。

| 配置 | 用途 | 默认值 |
| --- | --- | --- |
| `VITE_API_TARGET` | 开发时 API 代理目标 | `http://127.0.0.1:8787` |
| `VITE_BASE_PATH` | 主端的发布前缀 | `/` |
| `VITE_ADMIN_BASE_PATH` | 后台静态资源的发布前缀 | 开发 `/`；构建为主端前缀加 `admin/` |
| `VITE_API_BASE_PATH` | 后台 API 请求前缀，与静态资源前缀分开 | 开发 `/`；构建为主端前缀 |
| `VITE_WEB_URL` | 返回主端的地址 | 开发 `http://127.0.0.1:5173/`；构建为主端前缀 |

例如 `VITE_BASE_PATH=/qingjian/ pnpm build:admin` 生成 `/qingjian/admin/assets/…` 资源路径，后台请求 `/qingjian/api/admin/…`。独立部署时可显式配置上述前缀，并将 API 反向代理至同一服务。手机端开发入口可用 `VITE_ADMIN_URL` 指定后台地址。

特效库展示实际 HTML/GSAP 动画卡片，支持分类、搜索、播放、暂停、重播和进度拖动。选中特效后可实时预览文案与素材、保存设置并渲染 MP4；页面不展示时间轴源码。离开视口或隐藏页面后暂停动画，减少多个预览的开销。每个 iframe 使用 `sandbox="allow-scripts"`，隔离后台存储与令牌；预览协议还校验 iframe 身份和独立消息通道。兼容旧后端的 `{html}` 预览响应，发布切换期间由共享预览协议补全播放器。
