import { guiText } from "../../i18n/guiText";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { LogicalPosition } from "@tauri-apps/api/dpi";
import { Menu } from "@tauri-apps/api/menu";

type ImageAction = "copy" | "saveAs";

export function useImageMenu() {
  const [feedback, setFeedback] = useState("");
  const source = useRef("");
  const busy = useRef(false);
  const menu = useRef<Promise<Menu>>();
  useEffect(() => () => {
    // Popup completion does not mean the native menu resource can be released on every platform.
    void menu.current?.then((value) => value.close()).catch(() => console.warn("Could not release image menu"));
  }, []);

  const perform = async (action: ImageAction) => {
    if (busy.current) return;
    busy.current = true;
    setFeedback(action === "copy" ? guiText("正在复制图片…") : guiText("正在准备保存…"));
    try {
      const result = await invoke<{ completed: boolean }>("codex_gui_image_action", {
        request: { source: source.current, action },
      });
      setFeedback(result.completed ? (action === "copy" ? guiText("图片已复制") : guiText("图片已保存")) : "");
    } catch {
      setFeedback(action === "copy" ? guiText("图片未能复制，请重试。") : guiText("图片未能保存，请重试。"));
    } finally { busy.current = false; }
  };

  const open = (event: MouseEvent, url: string) => {
    event.preventDefault();
    if (busy.current) return;
    source.current = url;
    const position = new LogicalPosition(event.clientX, event.clientY);
    if (!menu.current) menu.current = Menu.new({ items: [
      { text: guiText("复制图片"), action: () => { void perform("copy"); } },
      { text: guiText("另存为…"), action: () => { void perform("saveAs"); } },
    ] }).catch((error: unknown) => { menu.current = undefined; throw error; });
    void menu.current.then((value) => value.popup(position))
      .catch(() => setFeedback(guiText("菜单未能打开，请重试。")));
  };
  return { feedback, contextMenu: isTauri() ? open : undefined };
}
