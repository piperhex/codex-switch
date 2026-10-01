# P2P 连接能力

聊天、终端和控制请求共用 `shared/remote-chat` 的连接协商、保活、重试和直连/中转切换逻辑。
Android、iOS 与 PC 原生客户端在服务器确认双方能力后，并行尝试 WebRTC、原生 TCP 和 EasyTier 用户态连接。
各条直连路径独立探测；相近延迟保持既有优先级，持续更快的路径经过切换门槛后接管，失败时继续使用现有中转。
EasyTier 路径需要更新原生包及配置自有发现节点，具体见 [部署说明](../apps/admin-go/DEPLOYMENT.md)。

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

## 与开源方案的对照

本次原生适配直接复用 [EasyTier 固定版本源码](https://github.com/EasyTier/EasyTier/tree/ed73d318bb3bf19601e227ab83dd61d66ce4b9f8)
中的连接内核，采用用户态数据通道，不安装虚拟网卡、不接管系统路由。该内核在会话期间独立于 ICE 重建持续运行。

| 能力 | 本次实现及边界 |
| --- | --- |
| LAN / IPv6 直连 | 独立收集本地候选；双栈 DNS 同时尝试；公网映射不会被多网卡地址挤掉 |
| UDP NAT 探测与复杂 NAT 打洞 | 原生端复用 EasyTier 的多目的地址 STUN、对称 NAT 打洞逻辑；需要独立 STUN 端点 |
| TCP 补充路径 | EasyTier TCP 打洞与现有 TCP 同时保留；现有拨号失败允许有上限的重试 |
| 路由器端口映射 | 原生端启用 EasyTier UPnP / NAT-PMP；尚未增加 Tailscale 的 PCP 策略 |
| 持续直连探测与中继兜底 | 内核不随 45 秒 ICE 代次重建；既有端到端加密 WebSocket 中继保持可用 |
| 路径诊断 | 记录候选类型、IPv6、实际 RTT、失败阶段及所选传输，不记录候选 IP、密钥或聊天内容 |
| 无人值守聊天 | Windows 服务使用相同内核；没有浏览器 WebRTC 的服务进程也能尝试直连 |
| Web | 使用相同恢复、诊断与会话逻辑；浏览器没有原生套接字，不能承诺同等复杂 NAT 打洞能力 |

[Tailscale 的 NAT 说明](https://tailscale.com/blog/how-nat-traversal-works)还包含端口映射和中继兜底；
[RustDesk 的会合客户端](https://github.com/rustdesk/rustdesk/blob/master/src/rendezvous_mediator.rs)协调直连及中继。
本项目没有实现完整 Tailscale VPN/DERP 协议，也没有复制 RustDesk 的整套远程桌面协议。
网易 UU 远程的具体打洞策略没有源码证据，不能根据延迟推断它在某次连接中一定是 P2P。

功能接近不等于实测成功率相同。发布验收应使用同一对设备、同一网络依次记录各产品的明确直连状态，覆盖
同 LAN、双栈家庭网络、手机蜂窝网络、双方 CGNAT、禁 UDP、网络切换，以及发现节点不可达。
记录至少直连成功次数/总次数、首次直连时间、选中路径、RTT 和中继流量；不能把中继可用计为打洞成功。

## Windows 锁屏恢复

聊天 P2P 与锁屏捕获是不同链路。安装的 SYSTEM 服务在当前控制台会话中启动捕获工作进程，捕获子进程在初始化
COM/编码器前绑定当前输入桌面。无人值守使用 GDI 路径，避免 WGC 在安全桌面上出不了画面。
锁屏/解锁使捕获进程退出时，最多在 15 秒内重新绑定并获取首帧，保留原有 WebRTC 会话和授权期限。
恢复会因断开或授权过期立即停止；纯心跳校验不再依赖临时不可访问的输入桌面。
首次打开捕获也会处理桌面切换期间的短暂失败。切换期间被 Windows 拒绝的输入不会关闭视频，也不会自动重放，
避免一次按键被重复执行；权限拒绝、授权过期或无效输入仍会结束控制。

代码测试不能替代安装服务后的 Windows 实测。验收包括先锁屏后连接、连接中锁屏/解锁、用户注销、UAC
安全桌面、授权撤销和服务重启。远程桌面音视频仍使用独立 WebRTC/TURN，聊天直连状态不代表画面直连状态。

## 本次验证范围

- Windows：原生自动发现、双向传输、跨保活周期的分片读取、错误密钥隔离、协调节点禁止转发、授权关闭，
  以及手机连接所有者替换后的清理测试通过；桌面 Rust / Clippy 和聊天连接测试通过。
- Android：四种 ABI 的 Rust 库、JNI/Kotlin 与 Gradle 构建通过。Android 14 ARM64 真机及 Android 15 x86_64
  模拟器已验证原生直连、63,488 字节中文/emoji 往返、续期、关闭拒发及重连；两端均通过公网协调节点测试，
  另分别验证 UDP-only 和 TCP-only 协调入口。数据路径确认为一跳直连，测试配置传递使用的 ADB 不承载 P2P 数据。
  应用登录、历史、消息、中继回退、断线恢复及后台返回回归通过。
- Linux：协调节点容器构建、无特权启动及公网 TCP/UDP 协调入口验证通过。
- CI：Windows、Linux、macOS 和 iOS 原生库编译通过，iOS 应用原生链接与未签名应用构建通过；
  Android / iOS JavaScript 导出、原生端类型检查和桌面 / Web 生产构建通过。
- 尚未验证：跨运营商、双侧 CGNAT 等复杂公网 NAT 成功率的产品对照，以及 iOS 真机端到端连接。
  公网协调可达及当前设备直连通过，不能推导出与 UU、EasyTier、Tailscale、RustDesk 相同的成功率。
