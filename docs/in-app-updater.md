# 应用内更新发布配置

桌面应用现在使用 Tauri Updater。在启动时，它会从 GitHub Release 的
`latest.json` 获取与当前平台匹配的已签名更新包；用户确认后，应用会下载、
安装并自动重启。

## 一次性配置

1. 将本机私钥文件 `apps/desktop/src-tauri/.updater/codex-switch.key` 的完整内容保存为仓库 Actions Secret：`TAURI_SIGNING_PRIVATE_KEY`。
2. 私钥绝不能提交、公开或替换。该文件已被 `.gitignore` 忽略；丢失它会导致已发布版本无法验证后续更新。
3. 提交并推送本次改动后，按现有流程创建 `vX.Y.Z` tag。Release 工作流会使用这个 Secret 签名安装包并上传 `latest.json` 与签名文件。

## 发布要求

- `apps/desktop/package.json`、`apps/desktop/src-tauri/tauri.conf.json` 和 `apps/desktop/src-tauri/Cargo.toml` 的版本必须一致，并且新 tag 的版本号更高。
- Windows 发布使用 NSIS 更新包，避免 MSI 安装需要管理员权限的常见问题。
- GitHub Release 必须是已发布状态。草稿 Release 不会被 `releases/latest` 端点返回。

## 验证

发布新版本后，在安装了旧版本的 Windows 或 macOS 应用中启动 Codex Switch。出现更新提示后，选择“安装更新”；应用应下载、校验签名、安装并重启到新版本。
