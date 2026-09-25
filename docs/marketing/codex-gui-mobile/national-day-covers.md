# 国庆假期封面

使用内置 imagegen 模式，分别编辑原有 16:9 与 4:3 封面。保留手机中的 Codex Switch 界面与手机连接电脑的主体，改成秋日山野、旅行箱、暖金色日光和少量红色节日点缀。

封面文字：Codex GUI；国庆出门；Codex 随身；手机远程，电脑继续跑；原模型执行。

## 提示词

Use case: ads-marketing / compositing.
Asset type: polished Chinese Bilibili video thumbnail for Codex GUI, National Day holiday campaign.
Input image: the supplied previous cover is the EDIT TARGET and product/interface reference. Preserve the recognizable Codex GUI product name, realistic smartphone with its clean white Codex Switch chat interface, and the idea of a phone remotely connected to a computer. Replace the previous studio background and all large promotional copy.
Primary request: a premium National Day holiday travel visual. Autumn mountain campsite / scenic road in the distant background, warm golden sunlight, restrained red holiday accents, a small travel suitcase beside the phone, and an elegant connection light arc leading to a laptop behind. Foreground remains tasteful deep forest green with cream/gold headline and subtle mint brand accents. Refined commercial 3D + photography, excellent text readability at thumbnail size. Holiday freedom and portable coding; avoid busy festival clutter.
Composition: large bold Chinese headline on the left, hero smartphone on the right, laptop set behind, spacious layout, strong visual hierarchy. Keep the phone screen legible and preserve its actual clean app appearance. Do not place account emails or credentials anywhere.
Use ONLY these exact promotional text strings outside the phone screen:
Top small product label: "Codex GUI"
Very large main headline, two lines: "国庆出门" / "Codex 随身"
Clear supporting line: "手机远程，电脑继续跑"
Small benefit badge: "原模型执行"
Remove the previous headline and the previous "真机实录" badge. Do not add claims about model quality benchmarks, unlimited speed, or guarantees of answer quality. Do not add any description of where this was recorded. No national flags, unrelated logos, watermarks, dates, or extra writing. Chinese text must be accurate, clean, and not cropped.

16:9 版本使用宽幅 1920×1080 构图；4:3 版本独立适配 1600×1200 构图，必要时将辅助文案分行。最终文件复制到本地成品目录并机械缩放至精确尺寸。

## 模型卖点依据

宣传文案将“模型不降智”具体表述为“远程操作，模型配置照旧”：沿用对话所选的模型及推理强度，由电脑上的 Codex 执行。

- `shared/remote-chat/client/composerSettings.ts` 同步电脑上的对话设置。
- `shared/remote-chat/client/controller.ts` 的 `send` 保留选择的 `model` 与 `effort`。
- `apps/desktop/src/remoteChat/operations.ts` 将远程请求交给相同的 `guiApi.request` 执行。
- `apps/desktop/src/pages/codexGui/composerScope.test.ts` 已覆盖手机创建对话时先保存推理强度再发送、电脑切换页面后仍保留该设置。

文案描述远程功能不会自行把模型配置降级，不承诺第三方模型供应商的服务质量或每一次回答的效果。
