# Codex Switch Native

React Native（Expo）移动端，用已登录的 Codex Switch 云端账号查看桌面首页的官方账号与用量概览。

## 启动

```bash
npm install
npm run start -w @codex-switch/native
npm run android -w @codex-switch/native
npm run ios -w @codex-switch/native
```

`npm run export:android -w @codex-switch/native` 可在不启动模拟器的情况下校验 Android JS bundle。

每个版本 tag 的 GitHub Release 会构建 `CodexSwitch-android.apk`，以及未签名的 iOS Release `.app.zip`。iOS 压缩包用于 CI 构建验证；如需安装到真机或提交 App Store，仍需在 CI 中配置 Apple 证书与 provisioning profile 以导出签名 IPA。

首次登录需输入部署的后端根地址（例如 `https://api.example.com`）及 Codex Switch 云端账号。登录令牌保存在 iOS Keychain / Android Keystore 支持的安全存储中；移动端仅读取 `/sync/accounts/summary`，不会接收账户授权内容。

生产环境应使用 HTTPS。为了便于连接现有局域网或本地开发后端，当前 Expo 配置允许 HTTP；发布前若只使用 HTTPS，可移除 `app.json` 中的明文传输配置。
