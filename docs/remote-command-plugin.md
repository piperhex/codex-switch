# 远程命令插件

在 PC 的 **Codex GUI → 插件 → 社区插件** 中安装“远程命令”。这是一个插件，
一次安装包含电脑发现、AI 命令调用和本机命令接收，无需分别安装客户端和服务端插件。

两台电脑登录同一个 Codex Remote 账号，并保持应用在线。目标电脑安装且未停用插件即可接收命令，
没有额外的“允许远程命令”开关。本机 AI 可在下一条消息中发现插件工具，例如：

> 检查我的办公室电脑的磁盘空间和占用较高的进程，分析卡顿原因。

AI 先调用 `remote_list_computers` 获取电脑名称、系统、在线和可用状态，再调用
`remote_execute`，使用确切的 `deviceId`。命令支持绝对工作目录、系统默认 shell、
1–60 秒超时（默认 30 秒），返回 stdout、stderr、退出码、超时标记、截断标记和耗时。
Windows 使用无窗口、非交互的 Windows PowerShell；macOS/Linux 使用 `/bin/sh`。
命令以桌面应用当前用户运行，不提升权限，不保留上次调用的 shell 状态。

插件停用或卸载后，该安装立即失去调用和接收权限，已有调用也会取消。不同 Codex Home
的安装相互独立；只要还有一个启用的安装，本机仍可接受同账号请求。
重新启用会更换本地凭据，旧的工具连接不能复活。命令执行期间断线、登出、超时也会取消执行；
已产生的修改不能撤销，连接失败后不应盲目重试会修改数据的命令。

## 实现边界

- 仅修改 `apps/desktop` 和 Go 后端 `apps/admin-go`，NestJS 保持冻结。
- 桌面插件安装器管理 MCP 配置、技能及每个 Home 的凭据，无需 Node/Python/SSH 或额外下载。
  仓库中的 manifest、技能和工具定义共同描述这个内置插件；运行时入口由安装器写入，
  不要把仅含资源的目录当成独立通用 MCP 服务安装。
- MCP STDIO 子进程通过仅监听 `127.0.0.1` 的本地服务调用桌面账号能力。
  每个调用都校验 Home 凭据与启停状态；浏览器 Origin 请求被拒绝。云端凭据不会进入 AI 工具结果。
- 复用 `/device-switch` 的账号认证与设备列表。Go 网关将命令绑定到同账号的目标电脑及其确切连接，
  仅向原请求方返回结果；其他账号、其他设备或被替换的连接不能提交结果。
- 使用现有 TLS WebSocket 通道传输命令与结果；这条控制链路没有聊天通道的端到端加密，
  协调服务会处理命令和输出，代码不持久化或记录其正文。
- 每台电脑同时执行一条命令，命令最多 16 KiB，每个输出流最多保留 64 KiB，超限继续排空管道。
  请求方断开会向目标发出取消；目标断开也会停止该连接所拥有的执行任务。
- 安装、检查、命令执行均在后台运行，插件状态轮询不重入，关闭页面会停止轮询。

## 发布与验证

需要一起发布包含此改动的 PC 版本和 admin-go 版本。旧服务端不会转发新命令；旧 PC 不会声明
`remote-command` 能力。无需新增数据库表或升级 SQL。

```powershell
npm run build:desktop
npx vitest run --root apps/desktop src/pages/skillsMarket/RemoteCommandCard src/pages/codexGui/GuiPluginsPage.test.tsx
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --test codex_switch_lib_tests
go -C apps/admin-go test ./...
```

双机验收：安装 → 列出目标 → 获取系统信息与中文输出 → 非零退出 → 超时 → 执行中停用 →
重新启用 → 执行中断线 → 卸载；同时操作桌面和查看插件页面，确认界面仍可响应。
