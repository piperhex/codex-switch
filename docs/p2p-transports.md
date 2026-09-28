# P2P 连接能力

聊天、终端和控制请求共用 `shared/remote-chat` 的连接协商、保活、重试和直连/中转切换逻辑。
Android、iOS 与 PC 原生客户端在服务器确认双方能力后，并行尝试 WebRTC 和原生 TCP；
可用时优先使用 WebRTC，TCP 为另一条直连路径，失败时继续使用现有中转。

| 客户端 | WebRTC | 原生 TCP 打洞 |
| --- | --- | --- |
| Android App | 支持 | 支持，Android 套接字适配 |
| iOS App | 支持 | 支持，CocoaAsyncSocket 端口复用适配 |
| PC App | 支持 | 支持，Rust 套接字适配 |
| 手机及 PC 网页 | 支持 | 不启用，网页独立运行 |

普通网页无法自行创建原生 TCP 套接字。网页继续通过 WebRTC 建立直连，并保留 WebSocket 中转，
不依赖浏览器扩展、客户端、本机辅助服务或实验性浏览器开关。
Chrome 的 Direct Sockets 面向另外安装的 Isolated Web Apps，不适用于当前普通网站。
参考：[Chrome Direct Sockets 文档](https://developer.chrome.com/docs/iwa/direct-sockets)。

远程桌面的音视频使用单独的 WebRTC/TURN 连接。聊天连接显示 P2P，并不代表画面也在直连。
无论客户端支持几条路径，网络的 NAT 和防火墙仍可能使直连失败，实际模式以连接状态为准。

## iOS TCP 构建与验证

`patch-tcp-punch.cjs` 同时维护 Android 和 iOS 的依赖补丁。
iOS 将 `react-native-tcp-socket` 的 CocoaAsyncSocket 依赖固定为 7.6.5；
Expo 的 `withIosTcpPunch.cjs` 在每次 `pod install` 后、原生编译前应用补丁。
源码或版本不匹配时停止构建，不能静默跳过补丁。

仅显式传入 `reusePort: true` 的 TCP 打洞连接启用 `SO_REUSEPORT`。
监听、发现服务器连接和对端连接在 bind 前启用端口复用，且保持同一个本地源端口；
其他 TCP 使用者（例如本地视频 HTTP 服务）沿用原行为。
iOS 的 IPv4/IPv6 通配地址分别选择对应地址族，再转换为 CocoaAsyncSocket 的接口描述格式。

在安装 Xcode 和 iOS 模拟器的 Mac 上运行：

```sh
node apps/native/scripts/test-ios-tcp-punch.cjs
```

该检查编译实际补丁后的 CocoaAsyncSocket，在 macOS 和 iOS 模拟器中分别验证 IPv4/IPv6：
监听、发现和对端连接共用端口，发现连接保持存活，64 KiB 往返收发及全部套接字关闭。
`.github/workflows/ios-tcp-punch.yml` 在相关修改推送后运行同一检查。
它验证原生套接字能力，不代表已完成真实手机跨公网 NAT 的端到端测试。

iOS 本地网络访问仍遵循系统授权与后台运行限制；没有新增后台保活权限。
