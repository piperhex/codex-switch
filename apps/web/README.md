# Codex Switch Web

面向手机浏览器的 Codex Switch Web 客户端，同时提供宽屏桌面布局。移动交互使用
Ant Design Mobile，桌面增强使用 Ant Design，应用状态由 Redux Toolkit 管理。

## 本地运行

先启动后端，再从仓库根目录运行：

```bash
npm run dev:web
```

开发服务器会把认证、同步、设备和 WebSocket 请求代理到 `http://127.0.0.1:8080`。
需要连接其他本地后端时可设置 `VITE_DEV_API_URL`，聊天信令同样通过 `/device-chat` 代理。

## Codex 聊天

底部导航和桌面侧栏均提供“聊天”入口。登录与 PC 相同的云端账号后，选择在线电脑，
即可查看和搜索 Codex Switch 内置 GUI 的聊天、发送消息、查看流式回复、补充要求、停止任务，
以及新建聊天、归档恢复、选择模型、处理审批和补充问题。界面与 Android 客户端保持一致。

Web 和 Android 共用聊天状态、历史同步、加密及重连逻辑。浏览器优先使用 WebRTC 直连 PC，
直连失败后通过 admin 加密中转。切换导航或浏览器进入后台时断开连接，返回后重新同步当前聊天。
聊天正文只保留在当前页面内存中。手机软键盘弹出时输入区随可视区域调整；Enter 换行，
Ctrl/Cmd + Enter 发送，中文输入法选词不会触发发送。

PC 与 admin 需更新到支持聊天的版本；部署方式与限制见 [手机连接 PC 聊天](../../docs/mobile-chat.md)。
生产环境使用 HTTPS，以支持安全的浏览器连接与账号登录。

```bash
npm run build:backend
npm run test:chat:e2e -w @codex-switch/web
```

浏览器回归在手机尺寸和桌面尺寸下操作实际 H5 页面，连接本机 PC/admin 测试端，
覆盖直连、加密中转、聊天操作及重连；不请求真实模型。需要本机 Edge，
其他环境可设置 `CHAT_TEST_BROWSER=chromium` 并安装 Playwright Chromium。
报告与截图保存在 `.codex-tmp/h5-chat-report` 和 `.codex-tmp/h5-chat-playwright`。

Android Chrome 实测使用可丢弃的 Android 15 模拟器。首次在该模拟器的 Chrome 中完成欢迎页，
选择不登录账号。测试通过 ADB 连接模拟器内的 Chrome，保留实际手机视口与软键盘。

```powershell
$env:ANDROID_SERIAL = 'emulator-5580'
$env:ANDROID_CHAT_DISPOSABLE = '1'
adb -s emulator-5580 reverse tcp:1422 tcp:1422
npm run test:chat:android -w @codex-switch/web
```

该流程执行完整 H5 聊天回归，并检查实际软键盘、进入后台后的连接清理及返回前台后的恢复。
完整设备截图和环境记录位于 `.codex-tmp/h5-android-playwright`，报告位于 `.codex-tmp/h5-android-report`。

## 容器与 Kong

生产构建默认使用 `/web/` 作为静态资源前缀。`apps/admin/docker-compose.yml` 会把独立的
`web` 容器加入现有 `kong-net`，Kong 通过 `codex-switch-web:80` 提供 `/web` 路由。
API 请求保持同源并携带 `Authorization: Bearer <JWT>`；`/sync`、`/devices` 和
`/admin/api` 由 Kong JWT 插件校验，登录和刷新令牌接口保持公开。

如果 Web 使用独立域名并从根路径发布，可在构建容器时设置
`VITE_WEB_BASE_PATH=/`，并通过 Kong 的 Host 路由将该域名指向 Web 服务。
