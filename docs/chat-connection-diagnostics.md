# 聊天连接诊断

Admin 的「聊天设置 → 中继连接 → 无响应等待时间」默认 30 秒，至少 1 秒。
对应 `relayHeartbeatTimeoutSeconds`，保存后会推送给在线客户端，并影响正在进行的探测。
客户端更新后生效。旧配置自动使用 30 秒，无需修改数据库结构。

直连连续 3 秒没有探测回复时，可以切换到仍然可用的中继；中继使用单独的等待时间，
避免短暂网络延迟或远端界面繁忙引起反复重连。网络明确断开时仍会立即进入恢复流程。

## 服务端日志

读取 admin-go 容器的标准输出和标准错误，按 `chat` 过滤。日志包含：

- `chat connection opened` / `chat authenticated`：连接编号、角色、匿名设备标识、协议版本和恢复意图。
- `chat frame queued`：注册、配对、恢复、对端离线、关闭、密钥交换、offer/answer 和 ICE 代次。
- `candidate_type`：仅记录 host、srflx、prflx、relay 等地址类型，不记录地址。
- `type=relay`：该会话在这个连接上首次排队转发中继数据。它不等同于客户端确认收到。
- `chat rejected`：协议校验、身份失效、无效会话或限流等拒绝原因。
- `chat connection closed`：关闭码、服务端原因、存活时长、入站帧数、入站字节数和省略日志数。
- `chat write failed` / `chat websocket heartbeat timeout`：写入失败或 WebSocket 保活超时。

先按匿名 `device` 查找同一电脑，再按 `session` 关联两端，按 `connection` 区分每次重连。
信令排队只证明协调服务收到并准备转发，不能证明 P2P 建立成功。
排队日志中的 `role` 是接收该消息的一端，可结合 offer/answer 和代次判断转发方向。
每个连接每分钟最多记录 60 条过程日志；中继流量和同类候选地址会合并记录，关闭摘要始终保留。

## 客户端日志

在浏览器或桌面 WebView 控制台启用 Debug/Verbose 日志，按 `[remote-chat]` 过滤。
同一个 `sessionId` 可与服务端日志关联，`role` 区分发起端和电脑端。

- `peer-created`、`peer-state`、`peer-retry`：直连尝试、状态和重试代次。
- `peer-create-failed`、`peer-offer-failed`、`peer-signal-failed`：失败所处阶段。
- `channel-closed`：数据通道关闭。
- `mode`：实际路径变化以及两条路径的健康状态。
- `relay-timeout`：中继未响应时长；据此确认是否因为超时主动重连。
- `link-failed`：逻辑连接终止。

日志不包含令牌、密钥、SDP、候选地址、聊天内容或文件内容。诊断不增加网络协议消息，
更新后的客户端仍可连接旧服务端。服务端升级后才能获得新增的线上日志。
