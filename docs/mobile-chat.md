# 手机与 H5 连接 PC 聊天

手机底部的“聊天”页连接同一云端账号下的 PC，访问 **Codex Switch 内置 Codex GUI** 的同一个
app-server 和独立 GUI 对话库。它不会复制其他 Codex Home 的历史，也不会启动第二个对话进程。
PC 主窗口关闭到托盘后仍可使用；退出 PC 应用、云端退出登录或设备离线后，手机会断开或重新连接。

手机支持查看和搜索历史、加载更多、继续聊天、新建聊天、流式回复、暂停和继续任务、
恢复已归档聊天、选择模型与思考深度、查看工具活动，以及处理审批和补充问题。
打开聊天时先加载最新 10 条消息，向上翻到顶部时显示加载图标，每次再加载 10 条，并保留当前阅读位置。
回复内容会在生成过程中持续显示，输入区上方显示处理已用秒数；电脑提供开始时间时，两端沿用同一时间。
进入“聊天”后直接显示新聊天输入页，优先连接在线电脑。
原生 App 的聊天侧栏左下角固定“新聊天”，右下角头像菜单提供电脑与聊天账户切换。
点击侧栏右上角搜索图标可打开独立搜索页，只显示聊天结果；底部输入栏位于键盘上方，输入后自动搜索。
输入栏可一键清空，右侧关闭按钮返回侧栏，并保留原来的聊天列表。H5 仍可点击顶部设备名称切换电脑。
点击左上角图标，或在聊天区域向右滑动，可打开聊天列表；向左滑动、点击空白区域或按返回键收起。
抽屉随手指移动，正常上下滚动聊天记录不会打开列表。
列表按电脑端的项目名称分组；没有项目的聊天归入“最近”。
点击项目名称右侧的“＋”，可在该项目中新建聊天；标题栏显示所选项目，发送后对话归入该项目。
普通聊天的标题栏不再显示“归档”按钮。
每个分组默认显示最多 5 条聊天，更多聊天通过“展开显示”查看，展开后可以收起；搜索时显示全部匹配结果。
收起时仍保留当前聊天，便于继续查看。
每行只显示标题和状态：正在回复时显示加载图标，未读回复显示灰点。任一端阅读后，另一端同步清除灰点。
输入框内的加号和圆形发送按钮分别固定在底部两侧，正文独占上方区域，多行输入也不会与按钮重叠。
生成回复时，没有草稿则显示暂停图标；输入文字或添加图片后可发送补充消息。
补充消息默认加入电脑上的待发送队列，两端同步显示。当前回复结束后，电脑自动按顺序发送队列内容；
点击某条消息的“立即发送”可马上补充到当前回复，也可删除待发送消息。手机断线或退出后，电脑继续处理队列；
重新连接时恢复展示，发送失败的消息保留以便重试。队列保存在电脑运行期间，退出电脑应用后不保留。
暂停后没有草稿时显示播放图标，点击即可继续任务。
编辑消息且输入法展开时，底部显示当前模型及推理强度，例如“GPT-6-Astra · 极高”，收起输入法后隐藏。
原生 App 可在输入时点击“/”，或直接输入“/”选择命令和技能；技能会随消息一起进入待发送队列。
模型列表、当前模型、推理强度及访问权限
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
连接尚未支持增量同步的旧版电脑时，客户端自动改用旧版读取接口；旧版返回的完整记录仍按 10 条显示。
旧版读取需要传输完整记录，建议更新电脑端以减少大型聊天的传输量。重连后会重新尝试新版同步。
旧版电脑尚不支持消息队列时，消息沿用直接发送或补充到当前回复的方式。
相邻文字片段最多合并 40 毫秒后发送，历史响应之前先发送已缓冲的片段，防止同一段文字重复显示。
PC 保留最近任务的实时状态，避免尚未写入历史的回复被旧记录覆盖；完成通知不再携带整轮正文。
Android App 登录且有可连接电脑时即建立聊天连接，切换 Tab、回到桌面或锁屏不会主动断开。
后台通过 remoteMessaging 前台服务和 Headless JS 保持收发及重连，通知栏显示“Codex Switch 聊天”。
退出登录、退出应用或移除最近任务时停止服务；系统强制停止应用或限制后台网络后仍可能中断。
只有当前聊天正在前台显示时才标记已读，后台完成的回复保留未读状态。
回复完成或失败时发送系统通知（手动停止不通知），同一轮回复只提醒一次；点击通知切换到对应电脑和对话，
即使对话不在当前列表页也会读取。通知目标绑定云端服务器和账号，避免登录其他账号后误开旧通知。
首次登录时申请通知权限；拒绝后仍可聊天，并在聊天页提供系统通知设置入口。
本次后台常驻适用于 Android；iOS 不主动断开连接，但系统挂起后需要 APNs 远程推送才能保证后台提醒，
当前未接入 APNs。H5 继续沿用网页可见性控制连接。

连接建立后先等待电脑聊天服务就绪，再允许发送；初始化失败会自动重试。连接或鉴权长时间没有完成时，
会清理旧连接并重新尝试，迟到的旧连接回调不会影响新的连接。手机重连和直连切换中转复用电脑现有聊天进程，
包括空闲时已加载的聊天。新聊天直接发送首条消息，已有聊天才恢复，避免恢复尚未写入历史的新聊天。

Android 聊天消息支持“查看全文”和复制；命令、工具结果和错误分别展示，长输出可继续展开。
代码支持自动换行或横向滚动；文件修改按文件显示增删行、行号和重命名，并可复制原始 diff。
“查看最近一轮文件修改”优先显示该轮最终差异；回复中的文件链接及 diff 中的“查看文件”可读取
当前项目内不超过 2 MB 的 UTF-8 文本。该操作只读，拒绝越界路径、网络路径及二进制文件。
文件读取失败可重试；已删除文件仍可查看 diff。文件内容显示电脑上的当前版本。
这些功能需要同时更新手机和电脑端。

电脑确认追加消息后会立即通知手机显示，正式消息到达后替换临时记录，避免重复。
排队消息仍先显示在待发送区域；提交确认后即可继续输入，不再等待聊天记录刷新完成。

点击输入框左侧加号可添加图片。H5 在抽屉中提供“相册”；原生 App 还支持拍照。
添加后显示缩略图，可移除或继续添加；支持只发送图片、图文一起发送，以及在回复过程中补充图片。
一次最多添加 8 张图片，大照片自动缩小；总大小过大时会提示减少图片。发送失败保留草稿，成功后清空已发送内容。
原生 App 增加相册选择模块，需要重新构建并安装应用。

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
  域名需要解析到服务器公网 IPv4 地址，也可以直接填写公网 IPv4 地址。
  云安全组和服务器防火墙均需允许 UDP 3478；面向任意网络的客户端时，IPv4 来源设为 `0.0.0.0/0`。
  无需开放 TCP 3478，也无需新增 Kong STUN 路由。
- 通用生产覆盖示例见
  [`docker-compose.override.example.yml`](../apps/admin/docker-compose.override.example.yml)。
  新部署可复制为 `docker-compose.override.yml`；已有覆盖文件应合并相关配置，保留其他设置。
  示例需要 Docker Compose 2.24.4+，将 HTTP 健康检查端口限制在本机，同时保留公网 UDP 3478。
  **`ports: !override` 会替换整个端口列表，必须显式保留 UDP 3478，否则基础文件中的映射会丢失。**
  修改后先运行 `docker compose config --quiet`，再按后端 README 应用配置，并从服务器外部验证
  STUN Binding 响应；HTTP 正常或 Docker 显示端口已发布，都不能替代公网 UDP 实测。
- `CHAT_STUN_PORT` 默认 `3478`，`CHAT_STUN_BIND` 默认 `0.0.0.0`。填 `CHAT_STUN_PORT=0`
  可停用内置 IPv4 STUN，并在 `CHAT_STUN_URLS` 中配置其他 STUN 服务，多个地址用逗号分隔。
- 未配置 STUN 时仍会尝试本地候选地址，但跨 NAT 的直连成功率降低；中转仍可工作。
- 本版会话注册表在单个 admin 进程内，生产部署应使用一个后端实例。多个副本需要按账号路由到同一实例，
  或先增加共享会话路由。Redis 账号缓存不承担聊天转发。
- WebSocket 有鉴权超时、令牌到期断开、心跳、帧大小、速率、缓冲和每台 PC 最多 4 个手机连接的限制。
- 设备与网络环境会影响直连率；对称 NAT、UDP 被封锁等场景会自动使用中转。

## 移动端构建

聊天连接使用原生 WebRTC 数据通道，无需相机或麦克风权限；拍照和扫码时才使用相机权限。
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
补充问题、在项目中新建聊天、项目归属与标题栏、强制断线恢复、切换 Tab 和前后台切换、图片显示和放大，
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

侧栏与搜索专项回归使用同样的临时模拟器及新的测试服务，运行
`npm run test:chat:android:search -w @codex-switch/desktop`。
覆盖回复期间的头像菜单、电脑和账户切换、独立搜索、清空与关闭、结果跳转和底部新聊天，
截图及 `search-report.json` 保存在同一结果目录。

分页与实时输出专项回归使用同样的可丢弃模拟器配置和新的测试服务，运行
`npm run test:chat:android:history -w @codex-switch/desktop`。
它检查首次 10 条、每次向上加载 10 条、加载图标、阅读位置、完成前的流式文字和处理中读秒，
结果写入同一目录的 `history-report.json`。

输入法与聊天位置专项回归使用同样的模拟器配置和新的测试服务，在仓库根目录运行
`node apps/desktop/e2e/android-keyboard-regression.mjs`。
它检查空输入框与草稿反复开关输入法时布局稳定、最新消息可见、旧消息阅读位置不变，
以及输入法打开时的流式回复；结果写入同一目录的 `keyboard-report.json`。

抽屉与旧版电脑兼容回归使用相同配置和新的测试服务，运行
`npm run test:chat:android:drawer -w @codex-switch/desktop`。
它模拟电脑拒绝新版历史接口，验证旧记录读取，以及边缘右滑打开、左滑收起、遮罩和返回键关闭。
结果写入同一目录的 `drawer-report.json`。

后台连接与通知专项回归使用相同的可丢弃模拟器配置和新的测试服务，运行
`npm run test:chat:android:background -w @codex-switch/desktop`。
检查启动即连接、切换 Tab 复用连接、后台完成通知、点击定位对话、后台断线重连和退出登录清理，
报告写入同一目录的 `background-report.json`。
