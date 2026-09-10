# 手机与 H5 连接 PC 聊天

手机底部的“聊天”页连接同一云端账号下的 PC，访问 **Codex Switch 内置 Codex GUI** 的同一个
app-server 和独立 GUI 对话库。它不会复制其他 Codex Home 的历史，也不会启动第二个对话进程。
PC 主窗口关闭到托盘后仍可使用；退出 PC 应用、云端退出登录或设备离线后，手机会断开或重新连接。

手机支持查看和搜索历史、加载更多、继续聊天、新建聊天、流式回复、处理中补充消息、停止任务、
归档/恢复、选择模型与思考深度、查看工具活动，以及处理审批和补充问题。
打开聊天时先加载最新 10 条消息，向上翻到顶部时显示加载图标，每次再加载 10 条，并保留当前阅读位置。
回复内容会在生成过程中持续显示，输入区上方显示处理已用秒数；电脑提供开始时间时，两端沿用同一时间。
进入“聊天”后直接显示新聊天输入页，优先连接在线电脑，也可以点击顶部设备名称切换。
点击左上角图标打开左侧聊天列表，按电脑端的项目名称分组；没有项目的聊天归入“最近”。
每个分组默认显示最多 5 条聊天，更多聊天通过“展开显示”查看，展开后可以收起；搜索时显示全部匹配结果。
收起时仍保留当前聊天，便于继续查看。
每行只显示标题和状态：正在回复时显示加载图标，未读回复显示灰点。任一端阅读后，另一端同步清除灰点。
底部直接显示当前模型及推理强度，例如“GPT-6-Astra · 极高”。模型列表、当前模型、推理强度及访问权限
与电脑端同步，任一端修改后都会更新另一端；电脑尚未打开聊天页面时，手机上的选择会在打开后接续使用。
访问权限包括“请求批准”“帮我批准”和“完全访问”，沿用电脑端相同的审批与访问范围。
“聊天设置”只显示模型、推理强度和访问权限三个入口及当前值，点击后在下一层抽屉中选择，选好后返回。
已有聊天和正在回复的聊天也可以调整设置，后续消息使用保存后的配置。重连或等待保存时仍可继续选择，
手机会保留尚未同步的修改并在连接恢复后保存；保存失败时可重新保存，未同步完成前暂不发送新消息。
新聊天默认使用 PC GUI 的无项目工作区。历史和执行结果均以 PC 为准，手机不持久化聊天正文。

## 连接方式

连接设计参考 RustDesk `src/client.rs` 中 `connect` / `request_relay` 和
`src/rendezvous_mediator.rs` 的协调流程：注册设备、交换候选地址、尝试直连、超时后回退。
没有复制 RustDesk 源码，也不使用 RustDesk 的 hbbs/hbbr 二进制或其私有协议。

1. PC 与手机连接 admin 的 `/device-chat` WebSocket，首帧发送登录令牌。
2. admin 校验令牌、用户状态和设备归属，只给同一账号的 PC 和手机配对。
3. admin 转发 WebRTC SDP 和 ICE 候选；内置 STUN 提供公网地址发现，手机与 PC 尝试直接建立数据通道。
4. 最多尝试约 10 秒。连接成功时，聊天数据直接在手机与 PC 之间传输，admin 只维持协调连接。
5. 直连失败或已建立的直连中断时，双方切换到 admin 的 WebSocket 加密中转。

两端以临时 X25519 密钥协商共享密钥，通过 HKDF-SHA256 派生会话密钥，使用 ChaCha20-Poly1305
加密聊天帧。会话 ID 参与密钥派生及附加认证，发送方向使用独立 nonce 空间；重复、篡改和跨会话帧会被拒绝。
admin 转发密文，不解析和保存正文。信令服务器及其 TLS 证书属于配对的信任边界。

大消息分片传输，双方有缓冲上限和背压。RPC 请求 ID 在连接方式切换时保持不变，PC 同时缓存处理中和已完成的
请求，避免重放发送操作。完整断线后不自动重发结果未知的消息，而是重新读取 PC 对话。
历史正文按消息游标分页，后续刷新仅传输已加载范围的变化；回复中的文字和工具输出直接发送实时事件。
相邻文字片段最多合并 40 毫秒后发送，历史响应之前先发送已缓冲的片段，防止同一段文字重复显示。
PC 保留最近任务的实时状态，避免尚未写入历史的回复被旧记录覆盖；完成通知不再携带整轮正文。
手机切换到其他 Tab 或退到后台时停止连接、定时器和订阅；回到聊天后重新连接并同步。

连接建立后先等待电脑聊天服务就绪，再允许发送；初始化失败会自动重试。连接或鉴权长时间没有完成时，
会清理旧连接并重新尝试，迟到的旧连接回调不会影响新的连接。手机重连和直连切换中转复用电脑现有聊天进程，
包括空闲时已加载的聊天。新聊天直接发送首条消息，已有聊天才恢复，避免恢复尚未写入历史的新聊天。

手机和 H5 支持在回复中显示网络图片、附带的图片及电脑任务里的图片，点击图片可以放大，加载失败可以重试。
电脑本地图片通过当前聊天的 `imagePreview` 读取，沿用电脑端的目录及文件引用校验，不开放任意文件读取。
超出聊天传输大小上限的预览返回加载失败，保留聊天连接。

Web/H5 的“聊天”页支持同样的操作，沿用手机端的配色、消息样式和输入区。
两端共用 `shared/remote-chat/client` 中的状态、历史和重连逻辑，各自接入原生或浏览器 WebRTC。
H5 使用当前云端会话，令牌续期后会在下次连接使用新令牌；切换导航、隐藏网页或退出登录会清理连接。
Web 容器构建包含共享代码，开发代理包含 `/device-chat`；部署配置与 PC/admin 的连接要求相同。

## 部署 admin

需要同步更新 admin、PC 应用和手机应用。仅安装手机 APK 无法让旧版 PC 或 admin 支持聊天。

- HTTP 反向代理必须转发 `/device-chat` 的 WebSocket Upgrade。它和 `/device-switch` 一样，
  在 WebSocket 首帧校验 JWT，不能要求浏览器握手时携带 Authorization 请求头。
- Kong 示例已添加 `/device-chat`。更新已有 Kong 路由时，保留其他所有已有路径。
- 生产环境使用 HTTPS/WSS。PC CSP 允许连接用户选择的云端 WebSocket 地址；令牌不放入 URL。
- `.env` 设置 `CHAT_STUN_URLS=stun:你的公网域名:3478`，放行 **UDP 3478**。
  Docker Compose 已映射该 UDP 端口；STUN 的 UDP 流量不经过 HTTP/Kong 路由。
- `CHAT_STUN_PORT` 默认 `3478`，`CHAT_STUN_BIND` 默认 `0.0.0.0`。填 `CHAT_STUN_PORT=0`
  可停用内置 IPv4 STUN，并在 `CHAT_STUN_URLS` 中配置其他 STUN 服务，多个地址用逗号分隔。
- 未配置 STUN 时仍会尝试本地候选地址，但跨 NAT 的直连成功率降低；中转仍可工作。
- 本版会话注册表在单个 admin 进程内，生产部署应使用一个后端实例。多个副本需要按账号路由到同一实例，
  或先增加共享会话路由。Redis 账号缓存不承担聊天转发。
- WebSocket 有鉴权超时、令牌到期断开、心跳、帧大小、速率、缓冲和每台 PC 最多 4 个手机连接的限制。
- 设备与网络环境会影响直连率；对称 NAT、UDP 被封锁等场景会自动使用中转。

## 移动端构建

使用原生 WebRTC 数据通道，不请求相机或麦克风用于聊天。扫码功能继续使用已有相机权限。
Expo Go 不包含该原生模块，需要开发构建或安装 APK；升级旧 APK 后需完整重启应用。
`withChatTransport.cjs` 为 iOS 添加本地网络说明，并将已有的 Android HTTP 配置写入 release manifest，
以支持自部署的局域网服务器。生产地址应使用 HTTPS。

```powershell
npm run check -w @codex-switch/native
npm run export:android -w @codex-switch/native
npm run build:apk
```

iOS 可以在 macOS 上使用现有 `prebuild:ios` / Xcode 工作流构建；Windows 无法验证 iOS 签名安装。

## 验证

```powershell
npm run test -w @codex-switch/backend
npm run build:backend
npm run test -w @codex-switch/native
npm run test -w @codex-switch/desktop
npm run build:desktop
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings
npm run test:chat:e2e -w @codex-switch/desktop
```

浏览器端到端测试使用本机 Edge。其他环境可设置 `CHAT_TEST_BROWSER=chromium` 并安装 Playwright Chromium。
它使用真实 WebRTC、同一套密文分片和 admin 会话路由，检查直连不产生中转流量、直连失败回退、
连接切换后的收发、大段流式内容传输时的界面计时器响应。认证与权限边界由后端测试独立覆盖。
这些测试不会请求模型，也不能替代蜂窝网络、不同 NAT 和真实 iOS 设备的部署验收。

`apps/desktop/e2e/mobile-fixture.mjs` 是仅绑定本机的 Android 模拟器测试服务，提供虚构设备和对话，
不得用于部署。在 desktop 目录运行它后，模拟器可使用 `http://10.0.2.2:1490`，或通过
`adb reverse tcp:1490 tcp:1490` 使用 `http://127.0.0.1:1490`。测试账号为 `mobile-test@example.test`，密码任意非空。

接口参考：[Codex App Server 官方文档](https://learn.chatgpt.com/docs/app-server)、
[React Native WebRTC 数据通道](https://react-native-webrtc.github.io/handbook/guides/basic-usage.html)。

## Android 模拟器回归

新增 `npm run test:chat:android -w @codex-switch/desktop`，直接安装并操作发布 APK。
测试覆盖登录、聊天入口、连接与历史同步、发送与流式回复、键盘布局、补充消息、停止、审批允许/拒绝、
补充问题、新建聊天、归档恢复、强制断线恢复、切换 Tab 和前后台切换、图片显示和放大，
以及模型、推理强度和三档权限同步、项目抽屉及双向已读同步、已有聊天在保存延迟时修改设置，
以及项目分组的展开和收起，共 16 个场景。
每个场景同时检查原生界面及 PC 测试端收到的操作，保存截图、APK SHA-256、结构化结果和运行日志。

使用 **Android 15 / API 35 的可丢弃模拟器**、JDK 17、Android SDK Platform 35 和 Build Tools 35.0.0。
脚本拒绝操作实体手机。由于需要清除测试应用数据，必须设置 `ANDROID_CHAT_DISPOSABLE=1`；
请用 `-read-only -no-snapshot` 启动模拟器，避免影响已有 AVD 数据。流式输出期间用轻量 UI Automator
读取器获取实时界面，避免系统 `uiautomator dump` 在等待界面空闲时返回旧文件。

1. 构建 APK：`npm run build:apk`，并构建后端：`npm run build:backend`。
2. 启动临时模拟器，如 `emulator -avd Pixel_9 -port 5580 -read-only -no-snapshot`。
3. 在 desktop 目录启动新的 `node e2e/mobile-fixture.mjs`，每次完整回归前重新启动该测试服务。
4. 设置环境并运行：

```powershell
$env:ANDROID_HOME = '你的 Android SDK 路径'
$env:JAVA_HOME = '你的 JDK 17 路径'
$env:ANDROID_SERIAL = 'emulator-5580'
$env:ANDROID_CHAT_DISPOSABLE = '1'
npm run test:chat:android -w @codex-switch/desktop
```

结果位于仓库 `.codex-tmp/android-chat-regression/report.md`，详细数据为同目录的 `report.json`，
每项操作对应一张 PNG。测试端只使用虚构账号和聊天，运行时不请求真实 Codex 模型，也不修改生产数据。

分页与实时输出专项回归使用同样的可丢弃模拟器配置和新的测试服务，运行
`npm run test:chat:android:history -w @codex-switch/desktop`。
它检查首次 10 条、每次向上加载 10 条、加载图标、阅读位置、完成前的流式文字和处理中读秒，
结果写入同一目录的 `history-report.json`。
