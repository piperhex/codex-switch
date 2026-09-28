# 回答抽屉位置稳定性

2026-09-28：给 `BottomSheet` 的 Modal 根部增加独立 `SafeAreaProvider`。

Modal 的原生视图不在页面的安全区 Provider 下。缺少自己的 Provider 时，Android
`SafeAreaView` 会测量自身；抽屉高度、取整后的屏幕位置和底部留白之间可能形成重复布局。
Provider 放在动画与键盘避让容器外，改为测量整个弹窗窗口，避免抽屉位置反过来改变安全区。

## 回归步骤

使用可清空数据的模拟器和 `apps/desktop/e2e/mobile-fixture.mjs` 本地服务。
登录本地测试账号后，向 `/test/sidebar` POST `{"action":"async-layout"}`，
打开「移动端聊天体验」里的「回答」。这个场景包含三行题目和一个自由输入框。

等待打开动画结束，再运行：

```powershell
$env:ANDROID_SERIAL='emulator-5580'
$env:ANDROID_CHAT_OUTPUT='answer-sheet-stability'
node apps/desktop/e2e/android-sheet-stability.mjs
```

脚本依赖 ADB、FFmpeg 和 FFprobe，录制 5 秒并检查每个实际显示帧的抽屉上沿。
允许 1px 视频边缘误差；重复的 2px 上下移动会失败。报告和视频保存在 `.codex-tmp`。
Android 会省略没有变化的帧，因此静止画面的视频时长可能比实际录制时间短。
也可以设置 `ANDROID_SHEET_VIDEO` 检查已有录屏，无需操作模拟器。

分别检查输入框聚焦后收起键盘，以及抽屉打开期间反复 POST
`{"action":"context-usage"}` 更新后台聊天状态。键盘切换和拖动动画应完成后再开始采样。

## 验证结果

- 用户录屏：103 帧，上沿在 y=1488/1490 之间反复移动，回归脚本检出 2px 抖动。
- 修复版 Android 35 模拟器，1080×2400、440dpi：聚焦后收起键盘，12 帧，0px；
  后台连续更新，39 帧，0px。原版在此模拟器上未重现真机的抖动，真机修复效果仍需回测。
- 原生类型检查、586 项测试通过；Android Release 四种 ABI 构建和完整性检查通过。
- Web 手机窄屏和桌面宽屏的回答、取消回归共 4 项通过，Web 与桌面生产构建通过。
  Web 使用浏览器弹层，没有原生安全区自测逻辑，无需套用此平台修复。
- Rust Clippy 通过；提交前还会执行仓库完整检查。
