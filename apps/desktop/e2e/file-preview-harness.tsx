import { createRoot } from "react-dom/client";
import { FilePreviewWindow } from "../src/pages/codexGui/filePreview/FilePreviewWindow";
import { filePreviewApi, type FilePreviewData } from "../src/pages/codexGui/filePreview/api";
import { fileApi } from "../src/pages/codexGui/fileApi";
import "../src/styles.css";
import "antd/dist/reset.css";

const params = new URLSearchParams(location.search);
const variant = params.get("kind") ?? "markdown";
const code: Record<string, string> = {
  yaml: 'name: preview\nenabled: true\nsteps:\n  - run: "echo hello"\n',
  rs: 'pub fn greet(name: &str) -> String {\n    format!("Hello, {name}")\n}\n',
  ps1: '$greeting = "Hello"\nWrite-Host $greeting\n',
  py: 'def greet(name):\n    return f"Hello, {name}"\n',
  swift: 'func greet(name: String) -> String { return "Hello" }',
  dockerfile: 'FROM node:20\nWORKDIR /app\nCOPY . .\nRUN npm install\n',
  ts: 'export function greet(name: string): string {\n  return `Hello, ${name}`;\n}\n',
};
const markdown = '# 项目说明\n\n支持 **Markdown**、表格和公式 $E=mc^2$。\n\n'
  + '| 格式 | 支持 |\n| --- | --- |\n| YAML | 语言高亮 |\n| 视频 | 播放和拖动 |\n\n'
  + '```typescript\nconst enabled: boolean = true;\n```\n\n'
  + '[配置文件](settings.yaml#L2) · [许可证](LICENSE)\n\n![示例图](preview-sample.svg)';
const html = '<!doctype html><html><head><link rel="stylesheet" href="preview-sample.css"></head>'
  + '<body><h1>HTML 预览</h1><button onclick="this.textContent=\'已点击\'">试一试</button>'
  + '<script>try{parent.document.body.dataset.leaked="yes"}catch{document.body.dataset.isolated="yes"}</script>'
  + '</body></html>';
const data: FilePreviewData = {
  path: `C:/project/docs/example.${variant}`, name: `example.${variant}`, kind: "text",
  text: code[variant] ?? "Unknown extension text", url: new URL("./fixtures/preview-sample.html", location.href).href,
};
if (variant === "markdown") Object.assign(data, { kind: "markdown", text: markdown, name: "项目说明.md",
  path: "C:/project/docs/项目说明.md", url: new URL("./fixtures/README.md", location.href).href });
if (variant === "html") Object.assign(data, { kind: "html", text: html, name: "示例.html" });
if (variant === "video") Object.assign(data, { kind: "video", text: null, name: "演示视频.mp4",
  url: new URL("./fixtures/video-preview.mp4", location.href).href });
if (variant === "image") Object.assign(data, { kind: "image", text: null, name: "预览.svg",
  url: new URL("./fixtures/preview-sample.svg", location.href).href });
if (variant === "badVideo") Object.assign(data, { kind: "video", text: null, name: "损坏的视频.mp4",
  url: new URL("./fixtures/preview-sample.svg", location.href).href });
if (variant === "large") Object.assign(data, { text: "export const enabled = true;\n".repeat(12_000),
  path: "C:/project/large.ts", line: 180 });
if (params.has("dark")) localStorage.setItem("codex-switch:theme-mode", "dark");
else localStorage.setItem("codex-switch:theme-mode", "light");
Object.defineProperty(globalThis, "isTauri", { value: true, configurable: true });
filePreviewApi.read = async () => data;
filePreviewApi.open = async target => { document.body.dataset.opened = JSON.stringify(target); return true; };
fileApi.applications = async () => [{ id: "vscode", name: "VS Code", kind: "editor" }];
fileApi.perform = async (target, action) => {
  document.body.dataset.action = JSON.stringify({ target, action });
  return { path: target.path, saved: false, text: data.text ?? undefined };
};
createRoot(document.getElementById("root")!).render(<FilePreviewWindow />);
