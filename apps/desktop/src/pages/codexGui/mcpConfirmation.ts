import { guiText } from "../../i18n/guiText";
import type { EventParams } from "./types";

const CHROME_ACTIONS: Record<string, string> = {
  get browser_open() { return guiText("打开这个网页"); }, get browser_navigate() { return guiText("前往这个网页"); }, get browser_close() { return guiText("关闭这个标签页"); },
  get browser_reload() { return guiText("刷新网页"); }, get browser_back() { return guiText("返回上一页"); }, get browser_forward() { return guiText("前往下一页"); },
  get browser_focus() { return guiText("切换到这个标签页"); }, get browser_click() { return guiText("点击页面中的元素"); }, get browser_fill() { return guiText("填写页面内容"); },
  get browser_type() { return guiText("输入这些内容"); }, get browser_key() { return guiText("按下这些按键"); }, get browser_select() { return guiText("选择这个选项"); },
  get browser_check() { return guiText("更改勾选状态"); }, get browser_scroll() { return guiText("滚动页面"); }, get browser_drag() { return guiText("拖动页面中的元素"); },
};
const PARAMETER_LABELS: Record<string, string> = {
  get url() { return guiText("网页"); }, get text() { return guiText("内容"); }, get value() { return guiText("内容"); }, get values() { return guiText("选项"); }, get key() { return guiText("按键"); }, get keys() { return guiText("按键"); },
  get checked() { return guiText("勾选"); }, get direction() { return guiText("方向"); }, get amount() { return guiText("距离"); }, get button() { return guiText("鼠标按键"); },
};
const PAGE_REFERENCES = new Set(["browserId", "tabId", "ref", "frameId", "fromRef", "toRef"]);

export function mcpConfirmation(params: EventParams) {
  const tool = params.message?.match(/"(browser_[a-z_]+)"/)?.[1];
  const action = params.serverName === "codex_switch_chrome" && tool ? CHROME_ACTIONS[tool] : undefined;
  const entries = Object.entries(params._meta?.tool_params ?? {});
  return {
    message: action ? guiText("允许{value1}吗？", { value1: action }) : params.message,
    details: entries.filter(([key]) => !action || !PAGE_REFERENCES.has(key)).map(([key, value]) => ({
      label: action ? PARAMETER_LABELS[key] ?? key : key,
      value: typeof value === "string" ? value : JSON.stringify(value),
    })),
  };
}
