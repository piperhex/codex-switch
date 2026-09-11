import { useRef } from "react";
import { Plus, SquareTerminal, X } from "lucide-react";
import { Tooltip } from "antd";
import { MAX_TERMINAL_TABS, type TerminalPanelState, type TerminalTab } from "./useTerminalPanel";
import { useTerminalResize } from "./useTerminalResize";
import { useTerminalSession } from "./useTerminalSession";
import styles from "./terminal.module.less";

export default function TerminalPanel({ panel, active }: { panel: TerminalPanelState; active: boolean }) {
  const host = useRef<HTMLElement>(null);
  const resize = useTerminalResize(host);
  const visible = panel.open && active;
  return <section ref={host} className={styles.panel} hidden={!visible} aria-label="终端"
    style={{ height: resize.height }}>
    <div className={styles.resize} role="separator" tabIndex={0} aria-label="调整终端高度"
      aria-orientation="horizontal" aria-valuemin={resize.minimum} aria-valuemax={resize.maximum}
      aria-valuenow={resize.height} {...resize.handle} />
    <div className={styles.toolbar}>
      <div className={styles.tabs} role="tablist" aria-label="终端标签页">
        {panel.tabs.map((tab, index) => <div key={tab.id} className={styles.tab} data-selected={panel.selected === tab.id}>
          <Tooltip title={tab.cwd || "终端"} styles={{ root: { maxWidth: 400 } }}>
            <button role="tab" id={`terminal-tab-${tab.id}`} aria-selected={panel.selected === tab.id}
              aria-controls={`terminal-pane-${tab.id}`} onClick={() => panel.select(tab.id)}>
              <SquareTerminal size={15} /><span>{tab.cwd || `终端 ${index + 1}`}</span></button>
          </Tooltip>
          <button aria-label={`关闭终端 ${index + 1}`} onClick={() => panel.remove(tab.id)}><X size={14} /></button>
        </div>)}
      </div>
      <Tooltip title="新建终端" styles={{ root: { maxWidth: 400 } }}>
        <button className={styles.iconButton} aria-label="新建终端" onClick={panel.add}
          disabled={panel.tabs.length >= MAX_TERMINAL_TABS}><Plus size={18} /></button>
      </Tooltip>
      <button className={`${styles.iconButton} ${styles.close}`} aria-label="收起终端" onClick={panel.hide}>
        <X size={17} /></button>
    </div>
    {panel.tabs.map((tab) => <TerminalPane key={tab.id} tab={tab} visible={visible && panel.selected === tab.id} />)}
  </section>;
}

function TerminalPane({ tab, visible }: { tab: TerminalTab; visible: boolean }) {
  const { host, info, status } = useTerminalSession(tab.cwd, visible);
  return <div className={styles.pane} hidden={!visible} role="tabpanel" id={`terminal-pane-${tab.id}`}
    aria-labelledby={`terminal-tab-${tab.id}`}>
    <div ref={host} className={styles.screen} aria-label={info?.shell ?? "终端"} />
    {status && <div className={styles.status} role="status">{status}</div>}
  </div>;
}
