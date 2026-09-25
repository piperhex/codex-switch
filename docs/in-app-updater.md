# 应用内更新发布配置

桌面应用使用 Tauri Updater，在后台检查并下载 GitHub Release 的 `latest.json`
中与当前平台匹配的已签名更新包。设置中的“自动安装更新”默认开启，已下载的
更新会在下次启动时自动安装。关闭后仍会检查和下载更新，但重启时不会自动
安装；用户仍可手动安装更新。此设置保存在本机，重新开启后恢复启动时自动安装。

用户手动安装已下载的更新前，应用会再次检查最新版本。如果有更新版本，则改为
下载该版本，完成后等待用户再次点击安装；没有更新版本时才安装已下载的版本。
检查最多等待 30 秒（包含重试）；检查失败或超时时保留已下载的更新，恢复弹窗操作，
用户可以重试或稍后安装。超时后才返回的检查结果不会替换已下载的版本。

Android 应用在“设置 → 关于 Codex Switch”中通过 GitHub Release API 检查
最新正式版本。发现更新后，系统 DownloadManager 会在后台下载安装包，下载
完成后应用会调用 Android 系统安装器。首次安装应用内更新时，用户可能需要在
系统设置中允许 Codex Switch“安装未知应用”。

## 一次性配置

1. 将本机私钥文件 `apps/desktop/src-tauri/.updater/codex-switch.key` 的完整内容保存为仓库 Actions Secret：`TAURI_SIGNING_PRIVATE_KEY`。
2. 私钥绝不能提交、公开或替换。该文件已被 `.gitignore` 忽略；丢失它会导致已发布版本无法验证后续更新。
3. 提交并推送本次改动后，按现有流程创建 `vX.Y.Z` tag。Release 工作流会使用这个 Secret 签名安装包并上传 `latest.json` 与签名文件。

## 发布要求

- `apps/desktop/package.json`、`apps/desktop/src-tauri/tauri.conf.json` 和 `apps/desktop/src-tauri/Cargo.toml` 的版本必须一致，并且新 tag 的版本号更高。
- `apps/native/app.json` 的 `expo.version` 和 Android `versionCode` 由发布脚本同步；不要手工复用旧的 `versionCode`，否则 Android 会拒绝覆盖安装。
- Android Release 必须包含名称带 `android` 且以 `.apk` 结尾的资产。当前工作流使用 `CodexSwitch-android-vX.Y.Z.apk`。
- Windows 发布使用 NSIS 更新包，避免 MSI 安装需要管理员权限的常见问题。
- GitHub Release 必须是已发布状态。草稿 Release 不会被 `releases/latest` 端点返回。

## 验证

手机和 Web 的“设置 → 电脑端版本”通过 `/device-switch` WebSocket 读取同账号电脑的版本，
支持检查更新及确认后远程安装。需要先部署支持 `app-update` 的 admin-go，并在电脑上安装
支持此能力的版本；旧电脑仍显示上次连接时的版本，远程更新按钮禁用，无需数据库升级。
指令仅转发到当前账号的目标电脑，下载和签名校验复用电脑端更新器。安装前会核对确认的
版本；如果版本变化，需要重新检查并确认。页面关闭不取消已发送的安装，断线和超时不会
自动重发安装指令；重新连接后读取实际版本，仅匹配目标版本才显示更新完成。

验证远程更新时，分别在手机和 Web 窄屏、宽屏打开此入口，检查离线电脑、旧版电脑、
无更新、下载失败、重复点击及安装后重连。安装会重启电脑端，应在测试安装环境中验证。

发布新版本后，在安装了旧版本的 Windows 或 macOS 应用中启动 Codex Switch。出现更新提示后，选择“安装更新”；应用应下载、校验签名、安装并重启到新版本。

在安装了旧版本的 Android 设备上进入“设置 → 关于 Codex Switch”，点击
“检查更新”。确认后台下载后，可离开该页面并在通知栏查看进度；下载完成后
应出现安装确认，系统安装器显示的目标版本应与 Release tag 一致。
