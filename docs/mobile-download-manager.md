# Android 下载管理

设置中的“下载管理”统一管理聊天文件与视频的下载，也可以从当前聊天项目或“此电脑”的本地硬盘中选择文件。
下载管理使用独立页面，左上角返回按钮回到设置；浏览文件时，左上角按钮和 Android 返回键逐级返回文件夹及下载列表。
页面隐藏底部导航，以卡片展示文件入口、空状态和下载任务，区分下载中、暂停、失败与完成状态。
下载列表显示状态、大小、速度，提供暂停、继续、打开文件和删除操作。删除只影响手机上的下载文件与记录。

下载由 `apps/native/plugins/downloads` 中的 Android 工作线程调度。它负责分块校验、解码、写入、保存进度和发布文件；
React 只订阅状态，传输桥接沿用已有的加密聊天连接，每个任务同时保留一个 256 KiB 请求，最多同时下载两个文件。
关闭文件预览、离开下载页面或切换设置页面均不会取消任务。切到手机桌面时沿用聊天前台服务保持连接。
强制停止应用、切换电脑或失去连接时保留已写入进度，重新连接后可以手动继续；不承诺绕过系统强制停止继续运行。

未完成的文件和原子更新的任务记录位于应用私有目录，完成后保存到系统下载目录的 `Codex Switch` 文件夹。
Android 10 及以上使用 MediaStore；Android 7–9 在首次下载时请求存储权限。
续传先重新打开源文件，检查大小和修改时间生成的版本标记；版本变化时从头下载，避免混合文件内容。
删除、暂停后的迟到响应会被丢弃，迟到的远程文件句柄会关闭。完成和未完成的文件均可删除。

电脑端新增 `downloadBrowse`、`downloadOpen` 请求，复用现有 `fileRead`、`fileClose` 分块接口。
项目模式保持项目目录边界；此电脑模式只允许已连接电脑的本地卷，拒绝 UNC、设备路径和相对路径。
目录遍历和文件操作均运行在 Rust 阻塞工作线程中。直连与中转下载继续使用既有大小限制。
手机和电脑都需要更新到支持这些请求的版本。iOS 保留已有的文件下载方式。

验证命令：

```powershell
npm run check -w @codex-switch/native
npm test -w @codex-switch/native
npm run build:desktop
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
```

原生回归使用本地 `mobile-fixture.mjs` 和只读、可丢弃的 Android 模拟器。
它覆盖逐级返回、离开页面、暂停和重启续传、后台下载、SHA-256 完整性、硬盘浏览、删除、空文件、版本变化和损坏分块重试。

```powershell
# 在 apps/desktop 中先启动本地夹具
node e2e/mobile-fixture.mjs
# 另一个终端；仅用于只读、可丢弃的 emulator-5580
$env:ANDROID_CHAT_DISPOSABLE = '1'
$env:ANDROID_CHAT_OUTPUT = 'android-downloads-regression'
# 如使用独立构建产物，可设置 ANDROID_CHAT_APK 的绝对路径
node e2e/android-downloads-regression.mjs
```
