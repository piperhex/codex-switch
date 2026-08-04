# Codex Switch Web

面向手机浏览器的 Codex Switch Web 客户端，同时提供宽屏桌面布局。移动交互使用
Ant Design Mobile，桌面增强使用 Ant Design，应用状态由 Redux Toolkit 管理。

## 本地运行

先启动后端，再从仓库根目录运行：

```bash
npm run dev:web
```

开发服务器会把认证、同步、设备和 WebSocket 请求代理到 `http://127.0.0.1:8080`。

## 容器与 Kong

生产构建默认使用 `/web/` 作为静态资源前缀。`apps/admin/docker-compose.yml` 会把独立的
`web` 容器加入现有 `kong-net`，Kong 通过 `codex-switch-web:80` 提供 `/web` 路由。
API 请求保持同源并携带 `Authorization: Bearer <JWT>`；`/sync`、`/devices` 和
`/admin/api` 由 Kong JWT 插件校验，登录和刷新令牌接口保持公开。

如果 Web 使用独立域名并从根路径发布，可在构建容器时设置
`VITE_WEB_BASE_PATH=/`，并通过 Kong 的 Host 路由将该域名指向 Web 服务。
