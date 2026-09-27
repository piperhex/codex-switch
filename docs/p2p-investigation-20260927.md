# P2P 连接调查与 Android Clash 真机验证

日期：2026-09-27。结论适用于本次设备和测试网络，不代表全量用户或跨运营商成功率。

## 已确认的原因

小米真机开启 Clash Meta 后，当前 Android WebRTC 把绑定到 Wi-Fi 的 UDP socket
公布成了 VPN 的地址。对端收不到正确的 Wi-Fi 候选，因此本来可用的局域网直连失败。
这不是仅靠开启 Clash「绕过私有网络」就能解决的问题：实测该开关原本已经开启。

在同一台手机、同一 WebRTC 版本、VPN 一直开启的独立探针中，只校正物理网卡候选地址，
数据通道就恢复双向传输。正式应用补丁也通过了手机到 Windows 虚拟机的聊天和远程桌面验证。

用户报告「UU 远程在相同条件下可以 P2P」与这个结果一致：网络具备直连条件。
本次没有分析 UU 的闭源实现，不能据此断言它采用了哪种打洞协议。

## 设备与控制条件

| 项目 | 条件 |
| --- | --- |
| Android | 小米 Civi 1S / 2109119BC，Android 14，USB ADB |
| 对端 | 已连接的 Windows 11 Hyper-V 虚拟机，应用设备名 ZH2 |
| 网络 | 手机、虚拟机、宿主机在同一 Wi-Fi/LAN 网段 |
| 原手机应用 | 1.6.2 |
| 修复应用 | 本仓库 1.6.5 release APK，保留登录数据覆盖安装 |
| 原生依赖 | react-native-webrtc 124.0.8；org.jitsi:webrtc 124.0.0 |
| Clash | 官方 ClashMetaForAndroid v2.11.34，arm64-v8a |
| VPN 配置 | 独立配置，所有流量 DIRECT，没有代理账号或订阅 |
| Clash 开关 | 绕过私有网络、允许应用绕过、DNS 劫持、系统代理开启；System Stack；IPv6 关闭 |

Clash APK 来自
[官方 release](https://github.com/MetaCubeX/ClashMetaForAndroid/releases/tag/v2.11.34)，
SHA-256：`1ce2f78d9258358c57b47dd538ee4a94aebd8d1e6afd05f67100d3cec1ca8a9c`。
本机初始没有安装 Clash，也未启用 VPN；安装及测试由用户明确授权。

## 实验结果

| 实验 | 结果与解释 |
| --- | --- |
| 原应用，VPN 关闭 | 可以连接 ZH2，显示 P2P |
| 原应用，VPN 开启 | 新建连接停留在中继；延长观察后连续 4 轮 ICE 协商均约 15.1 秒失败 |
| 原应用，同一会话关闭 VPN | 自动恢复 P2P，排除必须重启或重新登录的解释 |
| 独立探针，无 VPN | Wi-Fi host 候选正确，数据通道连接并完成 echo |
| 独立探针，VPN 开启 | Wi-Fi 与 VPN 两个 host 候选都公布 VPN 地址，连接失败 |
| 启用 requestVPN field trial | 仍失败，单纯增加 VPN 枚举不能修正地址 |
| 对端禁用 mDNS、公布字面 IP | 仍失败，问题不能仅归因于对端 mDNS |
| VPN 保持开启，探针校正地址 | 连接并完成 echo；精确 stats 版 connecting→connected 为 427 ms |
| 修复应用，VPN 开启 | 连续 3 次新建聊天连接均显示 ZH2 · P2P；首次批次约 80–81 ms 完成 connecting→connected |
| 修复应用，VPN 关闭 | 连续 3 次均显示 ZH2 · P2P |
| 修复应用，VPN 开启，远程桌面 | 显示直连，收到 1708×960 视频；截图/采样约 29–32 帧/秒；控制可以切换到 Windows 桌面并恢复 |

最终 APK 另外重做了 VPN 开启 3 次、关闭 3 次及远程桌面复验。
这里的毫秒数只计算 WebRTC 的 connecting→connected，**不是从点击到页面可用的总耗时**。
静止桌面的帧率会降低，单次帧率采样不是性能基准。

原应用前两次短观测只有 8 秒，不能当成完整 ICE 超时样本；失败周期来自第三次长观测。
原应用与修复 APK 的应用版本不同，因此另用同版本的独立原生探针隔离补丁变量。
探针使用 USB 仅交换信令，数据通道走 LAN UDP；浏览器只配置 host 候选，没有 TURN。
这避免了把中继转发误认作 P2P。

## 根因与补丁边界

上游 M124 的
[PhysicalSocket::Bind](https://github.com/jitsi/webrtc/blob/M124/rtc_base/physical_socket_server.cc)
先把 socket 绑定到 Android Network，再用 ANY 地址绑定端口。
[UDPPort::MaybeSetDefaultLocalAddress](https://github.com/jitsi/webrtc/blob/M124/p2p/base/stun_port.cc)
用默认网络地址替代 ANY；VPN 成为默认网络时，Wi-Fi socket 的 host 候选也可能得到 VPN 地址。

探针日志里同时存在 `wlan0 / Wifi` 和 `tun0 / VPN`，但两个候选的 IP 都是 VPN 的 `172.19.0.1`。
`getStats()` 仍能区分 Wi-Fi 候选（`networkType=wifi, vpn=false`）与实际 VPN 候选。
[JNI 转换](https://github.com/jitsi/webrtc/blob/M124/sdk/android/src/jni/pc/ice_candidate.cc)
对普通 onIceCandidate 传入 adapter type `0`，所以不能依赖 Java `candidate.adapterType` 来判断。

补丁位于 [native WebRTC helpers](../apps/native/patches/webrtc/README.md)：

1. 仅处理 UDP host IPv4，且原地址属于当前 VPN 接口。
2. 异步查询 stats，用地址、端口、优先级、协议和候选类型定位唯一候选。
3. 只校正非 VPN 的 Wi-Fi/Ethernet 候选，并要求对应物理网络只有一个可用 IPv4。
4. 保留真正 VPN、蜂窝、srflx、relay、TCP、IPv6、mDNS 以及元数据不足或有歧义的候选。
5. 回到 WebRTC executor 后发出事件；peer 已销毁时丢弃延迟回调。

没有把整个进程绑定到 Wi-Fi，没有调用 VPN protect，也没有改变系统路由或覆盖用户 VPN 策略。
修复的是发给对端的 trickle ICE 地址；原生 socket 和原始 local SDP 保持不变。
这不是任意 VPN 配置下强制直连的机制，严格禁止物理网络访问的策略仍会限制直连。

补丁在 postinstall 自动应用，锁定依赖版本，并在上游源码锚点变化时停止，要求重新审查。
聊天与远程桌面共用同一原生适配器，因此一起受益。
Web 使用浏览器自己的 WebRTC，没有 Android ConnectivityManager，也不能复制本修复；
共享信令和 UI 行为未更改，Web 已做对应构建和交互回归。iOS 不应用此 Android Java 补丁。

## 开源远程桌面和 IM 对照

| 项目 | 可核实的做法 | 对本项目的启示 |
| --- | --- | --- |
| [RustDesk 客户端](https://github.com/rustdesk/rustdesk/blob/master/src/client.rs) | 协商 NAT 信息，尝试多种传输路径，包括 TCP、UDP、IPv6，保留中继回退 | 原生打洞路径比浏览器 WebRTC 可控范围更大；不能假设只加 STUN 就能达到同样覆盖率 |
| [Jami LAN 文档](https://docs.jami.net/user/lan-only.html) | LAN peer discovery 可减少外部发现依赖；受限网络通过 TURN 回退 | 局域网发现、ICE 可达性和中继分别解决不同问题；发现设备不等于 socket 地址正确 |
| [Tox 协议](https://toktok.ltd/spec.html) | UDP 直连与 TCP relay 配合，维持多个 relay 以改善可用性 | 保持可用会话、后台争取直连；必须分开统计连接率和直连率 |

本项目 `shared/remote-chat/hotLink.ts` / `hotPeer.ts` 已有热中继、直连协商和重试，
并非完全缺少回退。此次记录证明反复重试同一个错误地址无效。

更广义的低成功率还有以下代码层面限制，但不能视作本次已实测的公网故障：

- `apps/admin-go/internal/devices/stun.go` 的 `CHAT_STUN_URLS` 默认空；内置 STUN 监听与
  向客户端下发可达公网 URL 是两个配置项。未正确下发时，跨 NAT 难以得到可用公网映射。
- 内置 STUN 是 IPv4 UDP。跨运营商、对称 NAT、双层 NAT 或 UDP 受限时，仍需分别测试。
- 聊天数据直连使用 WebRTC，回退是应用已有的加密 WebSocket 中继；聊天 STUN 配置不是 TURN 配置。
  视频另有 TURN UDP/TCP/TLS 能力。TURN 能改善连接可用性，但应归类为中继。
- 当前日志更擅长记录状态变化，后续应记录脱敏的候选类型、选中路径、失败阶段和耗时，
  用真实样本判断瓶颈，再决定是否增加原生 TCP/UDP 打洞或公网发现服务。

本次没有测量生产 STUN 的公网可达性，也没有跨运营商和双对称 NAT 对照。
手机移动数据原本关闭，未改变其移动数据设置。不能用同一 LAN 的结果声称公网成功率已全面解决。

## 复现与验证

测试配置（nameserver 使用测试 Wi-Fi 的路由器地址）：

```yaml
mixed-port: 7890
allow-lan: false
mode: rule
log-level: info
proxies:
  - name: TEST-DIRECT
    type: direct
dns:
  enable: true
  enhanced-mode: redir-host
  nameserver: [192.168.5.1]
rules:
  - MATCH,DIRECT
```

1. 手机与 Windows 对端接入同一 LAN，确认应用能完成设备配对。
2. 记录 VPN 关闭时的状态，开启上述 Clash 配置并保留默认网络开关。
3. 新建应用连接，观察至少 30 秒；记录 connecting/connected/failed 与 P2P/中继标记。
4. 安装带补丁的 APK，重复 VPN 开/关各 3 次；打开远程桌面检查视频、直连标记和控制反馈。
5. 用相同 WebRTC artifact 的独立探针对照原始与校正后的候选，要求实际 echo 成功。

已完成的自动验证：

- 原生 TypeScript 检查；最终原有及补丁测试合计 554 项通过。
- 独立 JVM 测试覆盖候选匹配、VPN 保留、歧义、缺失信息、IPv6、非 host、TCP 及无效输入。
- 共享聊天 RTC / hotPeer / hotLink：25 项通过。
- Android release 构建；APK 四种 ABI 的原生库检查通过。
- Web TypeScript 和 Vite 生产构建通过；远程桌面浏览器测试 9 项通过（横屏、竖屏、桌面）。
- Desktop TypeScript 和 Vite 生产构建通过。

构建有已有的大 bundle / Gradle 弃用提示，没有构建或测试失败遗留。
原始设备日志、含用户桌面的截图、测试 APK 和临时探针保留在本地 `.codex-tmp/p2p-investigation/`，
不提交到仓库。修复 APK 位于 `apps/native/android/app/build/outputs/apk/release/app-release.apk`。
测试结束后恢复 VPN 关闭，保留官方 Clash 及独立 DIRECT 配置供复验；移除独立探针和测试端口转发。
