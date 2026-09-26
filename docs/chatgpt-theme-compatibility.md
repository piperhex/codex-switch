# ChatGPT 桌面主题兼容性

## Windows 26.924.20706（2026-09-26）

实机通过 Microsoft Store 从 `26.915.4065.0` 更新至包版本 `26.924.1866.0`。
更新后 `app.asar/package.json` 中的客户端版本是 **26.924.20706**。

上游 [Codex-Dream-Skin #414](https://github.com/Fei-Away/Codex-Dream-Skin/issues/414)
报告相同版本应用主题后对话栏消失；排查时该报告仍开放、没有修复回复。
对照上游主分支 `34335d27d54300eccb325cc652f6c93fef428b84`（v1.5.18）及本地实际 DOM 排查。

### 根因与适配

- 新版把 `data-app-shell-main-content-top-fade` 放在整个内容容器上。
  旧兼容选择器将它与装饰渐隐层合并，再应用 `display: none`，导致主页和会话内容全部隐藏。
  现在只匹配渐隐层的旧类名或 `_MainContentTopFade_` 类名，并仅清除背景。
- 新主页的 `group/home-composer-layout` 自行管理公告、标题和输入框布局。
  旧版首子节点的固定高度规则会撑高空公告栏、造成输入框溢出；现已排除该现代布局。
  非宽图主题改由现代主页容器绘制插画，不再依赖旧版插画卡片。
- 输入框内层、新项目操作栏和侧栏新增了独立背景。
  现已清除重复输入框底色，适配项目栏、侧栏及新版文字与卡片颜色变量，保留原生字体设置。
- 启动超过 1.8 秒的页面此前会被错误缓存为已注入，后续不再重试。
  现在只有验证成功才缓存，等待期间只保留一个观察器；关闭主题时取消等待。
  桌面宠物及其合成窗口不参与主题注入和主窗口验证。

Windows 和 macOS 的公共页面适配均已同步。实机验收限于 Windows；macOS 通过浏览器回归验证。

### 验证方式

实机验证主页、已有会话、深浅色切换、背景、输入框、项目栏、侧栏和提示卡片。
检查内容容器非零尺寸、输入框内层背景透明、主页不再发生额外纵向溢出。

```sh
node --test scripts/dream-skin-renderer.test.mjs scripts/dream-skin-bootstrap.test.mjs
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --test codex_switch_lib_tests dream_skin_native
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml --check
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings
npm run build:desktop
```

浏览器用例覆盖新旧结构、宽图及竖图、内容容器可见性、主页空公告栏、内层底色、文字与背景配色、
保留字体及草稿、重复注入和清理。启动用例覆盖慢加载、失败后重试、等待取消和宠物窗口排除。

本机调试将已验证的 CSS 和 renderer 文件同步到 Codex Switch 安装目录，并在
`.codex-tmp/theme-compat/installed-assets-backup` 保留原文件。正式分发仍需包含本次改动的
Codex Switch 构建；主题预设资源包不包含这些内置兼容代码。
