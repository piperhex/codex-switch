# Android 聊天记录闪烁实机回归

## 环境：2026-09-14

- USB 连接的 Android 实体机：2109119BC，Android 14 / API 34，1080 × 2400。
- 本地 Hyper-V Windows 11 虚拟机运行 PC 应用，沿用现有上游 Codex Switch 连接。
- 手机和虚拟机均先从 1.5.8 覆盖升级到官方 [v1.5.10](https://github.com/piperhex/codex-switch/releases/tag/v1.5.10)。
  虚拟机安装退出码为 0，安装后进程响应正常；手机恢复 P2P 连接，登录与历史数据保留。
- 复现后以 v1.5.10 源码加本次修复单独构建 Android arm64 Release APK，再覆盖安装同一实体机。
  PC 保持官方 v1.5.10；本次没有发布新的版本号。

## 已复现并修复

### 图片陆续加载时挤动旧消息

打开含两张图片的已完成对话，文字先显示，图片预览依次替换加载提示并调整宽高比。
列表因此反复改变高度和滚动位置。原始录屏中，同一条最终回复的垂直位置变化范围为 750 个屏幕像素。

现在加载、显示、失败和重试共用固定比例的预览区域；图片按原比例完整缩放，点击仍可查看原图。
预览不再根据异步解码结果改变聊天行高度，Android 图片显示也不再使用额外淡入动画。

### 无工具的实时对话被加载提示遮住

在新聊天中要求真实模型输出 45 行中文，保持键盘展开。
官方版本的历史加载提示在等待及输出期间遮住消息，到完成后才出现最终内容。
原判断只放行包含处理活动的实时对话，遗漏了没有工具和过程说明的普通回复。

现在当前页面见过的运行中轮次均保持可见，完成时也不重新盖上加载提示。
重新打开已经完成的旧对话仍等待首次滚动定位，避免提前露出错误位置。

## 修复版实测结果

| 场景 | 结果 | 本地证据 |
| --- | --- | --- |
| 同一图片历史首次打开 | 回复位置变化 0 像素，29 个可匹配的实际录制帧 | `fixed-image-cold.mp4`、`fixed-image-cold-anchor.json` |
| 图片历史缓存重开 | 回复位置变化 0 像素，23 个可匹配帧 | `fixed-image-cached.mp4`、`fixed-image-cached-anchor.json` |
| 切换长对话后再次打开图片历史 | 回复位置变化 0 像素，24 个可匹配帧 | `fixed-image-repeat.mp4`、`fixed-image-repeat-anchor.json` |
| 图片放大与返回 | 原图可打开，返回聊天正常 | `fixed-image-preview.png` |
| 普通短历史 | 显示后未检测到再次空白或位置跳动 | `fixed-short.mp4`、`fixed-short-analysis.json` |
| 真实多轮长历史 | 显示后未检测到再次空白或位置跳动 | `fixed-long-history.mp4`、`fixed-long-history-analysis.json` |
| 新建纯文字对话、键盘展开 | 用户消息立即可读，45 行回复逐步显示，完整收到 `HISTORY-END` | `fixed-live-long.mp4`、`fixed-live-contact.jpg` |
| 上翻旧消息后开关键盘、前后台切换 | 同一条旧消息顶端位置变化均为 0 像素，保持 P2P | `reading-position.json` |

官方版本还测试了真实命令运行、任务完成和上翻后的恢复：模型执行一次输出与 45 秒等待，最后回复 `DONE`。
任务完成和前后台切换后已读旧消息的位置保留。对应录屏为 `release-active-recovery.mp4`。

录像和量化结果保存在本地 `.codex-tmp/phone-history-flicker/`，不随文档提交。
图片预览及阅读位置截图保存在 `.codex-tmp/phone-pc-parity/`。
位移测量使用录屏实际帧，对同一回复文字进行模板匹配；未将图片自身加载后的像素变化误算成位置变化。
本次覆盖同一局域网中的实体 Android 与 Windows 虚拟机，不包含 iOS、蜂窝网络或跨 NAT 环境。

## 验证与安装包

本次修复在独立源码副本中验证，避免混入工作区同时进行的其他功能修改：

- Android TypeScript 检查及 50 个测试文件、239 项测试通过。
- 新增测试覆盖无工具轮次开始、流式追加、完成后保持可见及重新打开已完成历史。
- Rust 格式检查通过，1,110 项测试通过、5 项忽略；严格 Clippy 检查通过。
- 桌面 TypeScript / Vite 生产构建通过。
- Android arm64 Release 构建成功，并已覆盖安装实体机。

修复包：`.codex-tmp/phone-history-flicker/CodexSwitch-1.5.10-history-fix.apk`。
SHA-256：`6c38448389bcf45f6e1b2d3ead914030e0073a8c59fdc37a29b7bf66c295cc28`。

## 实时输出与文件卡片：2026-09-17

本次录屏中的问题发生在任务运行中：连续文字插入到「已编辑 55 个文件」卡片前，
原生列表先显示变高后的布局，JavaScript 下一帧才滚回底部，卡片因此短暂下移再复位。
这与上次的图片尺寸变化、键盘裁剪及历史加载遮罩不同。

Android 现在在原生布局更新时保持底部，并在 Fabric 完成整批布局调整后再次校准，
不再等待 JavaScript 的内容高度回调。手指拖动、惯性滚动及加载旧记录时暂停跟随；
点击「回到底部」后恢复。原生消息锚点始终启用，避免动态启用时替换被锚定的视图；
展开的处理分组使用实际消息作为锚点，避免旧页扩展分组时丢失阅读位置。
iOS 和缺少新原生模块的旧安装包沿用原有滚动逻辑。

### 实机与模拟器证据

使用真实 `ChatMessages`、90 条命令记录、55 个文件差异及每 100ms 追加一次的文字构造独立测试应用。
它不连接账号或模型，包名为 `com.codexswitch.mobile.scrolltest`，与正式应用分别安装。

- Pixel 9 模拟器：旧逻辑的 414 个可匹配帧中，19 帧发生卡片位移，半分辨率录屏最大变化 29px；
  初版修复的 431 个可匹配帧位置变化为 0px。
- 最终版本的完整模拟器回归通过，395 帧中没有卡片位移；上翻阅读期间开关键盘、
  手动回到底部、纯文字输出以及短处理记录向前分页均通过。
- Android 14 实体机 2109119BC：最终版本录屏的 562 个可匹配帧位置变化为 0px。
- 本地证据在 `.codex-tmp/android-flicker-0917/`，包括原录屏抽帧、修复前后视频、位置测量及检查日志。
  视频不随代码提交。

Android TypeScript 检查、64 个测试文件中的 339 项测试、桌面 TypeScript/Vite 生产构建通过。
Rust 格式、严格 Clippy 及 1,223 项测试通过（5 项忽略）。Android arm64 Release APK 构建成功，
正式应用尚未覆盖安装；实体机验证结束后移除了独立测试应用。

修复包：`.codex-tmp/android-flicker-0917/CodexSwitch-1.5.26-android-scroll-fix.apk`。
SHA-256：`06abf84e3b3075130d9ed5c2da3617191a138113206413aa21a42c759c8fce07`。

### 可重复回归

先配置 JDK 17、Android SDK、`adb` 与 `ffmpeg`，启动 1080×2424 的 Pixel 9 模拟器。
在 `apps/native` 目录运行以下命令，生成分别安装的测试 APK：

```powershell
node scripts/expo.cjs prebuild --platform android --no-install
$env:NODE_ENV = 'production'
$env:NODE_PATH = "$PWD/node_modules"
Push-Location android
.\gradlew.bat assembleRelease -PreactNativeArchitectures=x86_64 --init-script ../e2e/chat-scroll.init.gradle
Pop-Location
```

然后在仓库根目录运行：

```powershell
$env:ANDROID_SERIAL = 'emulator-5580'
$env:ANDROID_CHAT_OUTPUT = 'android-stream-scroll-regression'
node apps/desktop/e2e/android-stream-scroll-regression.mjs
```

测试逐帧检查持续输出时的文件卡片，验证底部和上翻阅读时开关键盘、手动回到底部、
不带文件卡片的纯文字输出，以及短处理记录的向前分页。
分析只容忍一物理像素的字体栅格舍入；整行文字跳动会失败。
结果与视频保存在所选输出目录。正式 APK 应重新运行不带测试 `--init-script` 的构建命令。

## 长历史停在加载中：2026-09-25

使用本机一段 3 轮、376 条记录的真实聊天，在 Android 14 实体机 2109119BC 的独立测试应用中复现。
最新 10 条记录可以显示；完整历史挂载时一直显示「正在加载聊天记录」。

原生列表分批测量后连续两次跟随底部。末次布局将内容高度从约 10832dp 增至 11074dp，
但 `scrollEventThrottle={100}` 丢弃了间隔不足 100ms 的最后一次滚动事件。
JavaScript 保留旧位置，首屏定位检查因此始终无法通过；数据已加载，遮罩仍然存在。

首次定位完成前改用 16ms（React Native Android 不丢弃滚动事件），完成后恢复 100ms。
仍然要求末尾真实消息完成测量并且可见，避免提前显示虚拟列表的空白占位。

同一数据修复后收到最终滚动位置并移除遮罩；重复切换长短历史、开关键盘均正常。
新增回归覆盖末次滚动事件、虚拟占位、首个历史响应、卸载清理及列表属性传递。
移动端 87 个测试文件、482 项测试和 TypeScript 检查通过。

本地复现数据、独立测试 APK、诊断日志和截图位于 `.codex-tmp/long-chat-loading/`，不随代码提交。
本次电脑在手机上显示离线，因此未复测当时的 Relay 传输；验证覆盖相同聊天数据的原生渲染过程。
