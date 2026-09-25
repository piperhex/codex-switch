# Codex GUI 手机远程宣传片

2026-09-25 制作。用安卓实体手机连接 Windows 11 虚拟机，完整演示同一条对话里的网页生成、追加需求、文件差异及 HTML 预览。

## 交付

本地成品位于仓库根目录 `dist/promo-20260925/`，录制原片位于 `.codex-tmp/promo-20260925/`。两个目录均属于本地制作产物，不提交账号画面、设备原片或临时调试数据。

- `Codex-GUI-mobile-1080p.mp4`：1920×1080，30 fps，H.264 / AAC，约 91 秒，内嵌中文字幕。
- `cover-16x9-1920.png`：1920×1080 封面。
- `cover-4x3-1600.png`：1600×1200 封面。
- `subtitles.srt`：独立字幕。
- `bilibili.md`：标题、简介和标签。
- `voiceover.mp3`：无背景音乐的女声旁白。

视频仅在本地导出，未上传或发布。

## 实录内容

使用 Xiaomi Civi 1S 安卓真机和 Hyper-V Windows 11 虚拟机。电脑固定分配 16GB 内存。录制前，用户指定的 36 条旧 Codex GUI 对话已通过应用会话管理移入回收站；演示另建对话。

第一轮任务从手机提出：生成深绿色的「星野露营」单页，包含标题、三个亮点卡片和按钮。电脑实际生成 99 行 HTML/CSS，并向手机返回文件链接。第二轮继续从手机提出：按钮改为「周末就出发」，增加「无需远行，也能遇见山野」。实际修改为 +2 / −2，手机和电脑均显示完成，手机预览也确认了对应文案。

两个设备的工作画面来自真实录制。视频压缩等待并放大部分界面；不声称跨蜂窝网络、特定响应速度或未测试的平台效果。静止界面按旁白时长保留末帧，录屏统一转换为 30 fps。

## 制作方式

- 手机：scrcpy 3.2，无音频录制，720×1600，最高 30 fps。原生 1080×2400 screenrecord 曾生成空文件，因此未使用这些失效文件。
- 电脑：ffmpeg 录制虚拟机连接窗口，仅裁取 Codex GUI 区域。
- 旁白：`zh-CN-XiaoxiaoNeural`，正常语速、正常音高。配音文本见 `narration.json`。
- 音乐：`render.py` 用正弦音生成原创轻背景音，无外部音乐采样。
- 排版：ffmpeg drawtext / overlay / ASS，使用本机 Microsoft YaHei。字体文件不随工程分发。
- 封面：内置 imagegen 模式生成，以真实手机新聊天页为视觉参考，再机械缩放到精确比例。封面是宣传合成图，视频中的操作界面为实录。

封面提示词记录：深墨绿和薄荷绿的中文 Bilibili 科技产品封面；左侧超大清晰标题「手机远程」「用 Codex」，上方「Codex GUI」；右侧突出手机，后方电脑和柔和连接光弧；辅助文案「电脑继续跑，手机随时接」及「真机实录」；参考真实手机截图，避免账号、凭据、虚构性能数字。分别构图 16:9 和 4:3，4:3 将辅助文案拆为两行。参考图和生成原图保留在本地制作目录及 imagegen 输出目录。

## 复现

依赖 Python 3.13、ffmpeg / ffprobe、`edge-tts`，以及 Windows 本机字体。

```powershell
py docs/marketing/codex-gui-mobile/voice.py --output .codex-tmp/promo-20260925
py docs/marketing/codex-gui-mobile/render.py --source .codex-tmp/promo-20260925 --output dist/promo-20260925
```

`scenes.json` 定义取材、时间点、排版和裁切，裁切按 `[x, y, width, height]` 记录。`--scene N` 可单独预览某段；改字幕后可用 `--assemble-only` 复用已渲染镜头。

所需原片：`phone-result-scroll.mp4`、`phone-connect.mp4`、`phone-send.mp4`、`phone-diff-final.mp4`、`phone-preview-final.mp4`、`desktop-followup.mp4`；配音文件为 `voice-01.mp3` 至 `voice-09.mp3`。

## 验收

检查全部视频流可完整解码，视频尺寸、帧率、音轨、封面比例及字幕时间有效；抽查全部章节、发出要求与执行结果、代码差异、网页按钮、字幕排版。避开账号页、邮箱、密码及旧会话内容。完整响度检查记录与视频抽帧保留在本地制作目录。
