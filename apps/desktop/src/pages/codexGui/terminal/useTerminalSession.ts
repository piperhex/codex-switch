import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { connectTerminal } from "../../../../../../shared/terminal/connection";
import { terminalTheme } from "./theme";
import type { TerminalApi, TerminalInfo } from "../../../../../../shared/terminal/types";
import "@xterm/xterm/css/xterm.css";

export function useTerminalSession(cwd: string, visible: boolean, api: TerminalApi, session?: TerminalInfo) {
  const host = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal>();
  const [info, setInfo] = useState<TerminalInfo>();
  const [status, setStatus] = useState("正在打开终端…");
  useEffect(() => {
    if (!host.current) return;
    const element = host.current;
    const terminal = new Terminal({ cursorBlink: true, fontSize: 13, scrollback: 5000,
      fontFamily: '"Cascadia Mono", Consolas, "Courier New", monospace', allowTransparency: false,
      theme: terminalTheme(document.documentElement.dataset.theme === "dark") });
    terminalRef.current = terminal;
    const fit = new FitAddon(); terminal.loadAddon(fit); terminal.open(element);
    if (element.clientWidth && element.clientHeight) fit.fit();
    const connection = connectTerminal({ api, cwd, session, size: { cols: terminal.cols, rows: terminal.rows },
      onReady: (value) => { setInfo(value); setStatus(""); }, onError: setStatus,
      onEvent: (event) => {
        if (event.type === "output") terminal.write(new Uint8Array(event.data));
        if (event.type === 'reset') terminal.reset();
        if (event.type === 'connection') {
          terminal.options.disableStdin = !event.connected;
          setStatus(event.connected ? '' : '连接中断，恢复后可继续使用。');
        }
        if (event.type === "error") setStatus(event.message);
        if (event.type === "exit") {
          terminal.options.disableStdin = true;
          setStatus("终端已结束，可以新建一个终端。");
        }
      } });
    const input = terminal.onData(connection.input);
    // xterm also emits internal flags that the terminal request does not accept.
    const resize = terminal.onResize(({ cols, rows }) => connection.resize({ cols, rows }));
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { if (element.clientWidth && element.clientHeight) fit.fit(); });
    });
    observer.observe(element);
    const themeObserver = new MutationObserver(() => {
      terminal.options.theme = terminalTheme(document.documentElement.dataset.theme === "dark");
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    terminal.attachCustomKeyEventHandler((event) => handleClipboard(event, terminal, setStatus));
    return () => {
      cancelAnimationFrame(frame); observer.disconnect(); themeObserver.disconnect();
      input.dispose(); resize.dispose(); connection.dispose(); terminal.dispose(); terminalRef.current = undefined;
    };
  }, [cwd, api, session]);
  useEffect(() => { if (visible) terminalRef.current?.focus(); }, [visible]);
  return { host, info, status, input: (data: string) => terminalRef.current?.input(data, true) };
}

function handleClipboard(event: KeyboardEvent, terminal: Terminal, report: (message: string) => void) {
  if (event.type !== "keydown" || !(event.ctrlKey || event.metaKey)) return true;
  if (event.key.toLowerCase() === "c" && terminal.hasSelection()) {
    event.preventDefault();
    void navigator.clipboard.writeText(terminal.getSelection()).catch(() => report("复制失败，请重试。"));
    return false;
  }
  if (event.key.toLowerCase() === "v" && event.shiftKey) {
    event.preventDefault();
    void navigator.clipboard.readText().then((text) => terminal.paste(text)).catch(() => report("无法粘贴，请重试。"));
    return false;
  }
  return true;
}
