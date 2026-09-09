import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Alert, Button, Popover } from "antd";
import { Download, PanelLeftClose, PanelLeftOpen, RefreshCw } from "lucide-react";
import { hasLocalBackend, isDesktopApp } from "../api/backend";
import { GuiController } from "./codexGui/controller";
import { ThreadSidebar, threadTitle } from "./codexGui/ThreadSidebar";
import { Composer, type ComposerHandle } from "./codexGui/Composer";
import { Messages } from "./codexGui/Messages";
import { Approvals } from "./codexGui/Approvals";
import { Installer } from "./codexGui/Installer";
import { useCliInstaller } from "./codexGui/useCliInstaller";
import { DetailsWorkspace } from "./codexGui/DetailsWorkspace";
import { ConversationChangesButton } from "./codexGui/ConversationChangesButton";
import { useGuiLayout } from "./codexGui/useGuiLayout";
import styles from "./codexGui/styles.module.less";

type CodexGuiPageProps = { active: boolean; accountPicker: ReactNode };

export function CodexGuiPage({ active, accountPicker }: CodexGuiPageProps) {
  useGuiLayout(active);
  const [visited, setVisited] = useState(active);
  useEffect(() => { if (active) setVisited(true); }, [active]);
  if (!visited) return null;
  if (!hasLocalBackend) return <div className={styles.install}><h2>Codex GUI</h2><p>请打开 Codex Switch 提供的网页地址，开始对话。</p></div>;
  return <Workspace active={active} accountPicker={accountPicker} />;
}

function Workspace({ active, accountPicker }: CodexGuiPageProps) {
  const [controller] = useState(() => new GuiController());
  const composer = useRef<ComposerHandle>(null);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [collapsed, setCollapsed] = useState(() => window.innerWidth < 900);
  const installer = useCliInstaller(active, controller);
  useEffect(() => { controller.activate(); return controller.dispose; }, [controller]);
  useEffect(() => {
    if (isDesktopApp || !installer.version) return;
    if (active) void controller.connect();
    else controller.suspend();
  }, [active, controller, installer.version]);
  const current = state.selected ? state.conversations[state.selected] : undefined;
  const thread = current?.thread ?? state.threads.find((entry) => entry.id === state.selected);
  const pending = state.approvals.filter((event) => event.params.threadId === state.selected);
  const otherApproval = state.approvals.find((event) => event.params.threadId !== state.selected);
  const running = state.sending || Object.values(state.conversations).some((value) => value.activeTurn);
  const canQuote = state.connection === "ready" && !state.sending && !state.archived
    && state.compacting !== state.selected;
  return <DetailsWorkspace selected={state.selected} active={active}>
    <div className={`${styles.page} ${collapsed ? styles.collapsed : ""}`}>
    {!collapsed && <ThreadSidebar state={state} controller={controller} accountPicker={accountPicker} />}
    <div className={styles.workspace}>
      <header className={styles.header}>
        <Button type="text" icon={collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          aria-label={collapsed ? "展开对话列表" : "收起对话列表"} onClick={() => setCollapsed(!collapsed)} />
        <div className={styles.heading}><strong>{thread ? threadTitle(thread) : "Codex GUI"}</strong>
          <span>{thread ? (isDesktopApp ? "本地对话" : "主机对话") : "在这里，把想法变成现实"}</span></div>
        <div className={styles.headerActions}>
          <ConversationChangesButton value={current} />
          {installer.version && <Button type="text" icon={<RefreshCw size={16} />} aria-label="重新连接 Codex"
            disabled={Boolean(running)} loading={state.connection === "connecting"}
            onClick={() => void controller.connect()} />}
          <Popover trigger="click" placement="bottomRight"
            content={<Installer installer={installer} compact running={Boolean(running)} />}
            styles={{ root: { maxWidth: 400 } }}>
            <Button type="text" icon={<Download size={16} />}>
              {installer.version ? `v${installer.version}` : "Codex"}</Button>
          </Popover>
        </div>
      </header>
      {state.error && <Alert className={styles.error} message={state.error}
        type="error" closable onClose={controller.clearError} />}
      {otherApproval && <button className={styles.pendingBanner}
        onClick={() => void controller.select(otherApproval.params.threadId!)}>另一个对话需要你的确认，点击查看</button>}
      {!installer.version ? <Installer installer={installer} /> :
        <Messages value={current} selected={state.selected} active={active}
          onQuote={canQuote ? (quote) => composer.current?.addQuote(quote) ?? false : undefined}
          pendingRequest={state.pendingRequest} footer={<>
          <Approvals events={pending} controller={controller} />
          <Composer ref={composer} state={state} controller={controller} active={active} />
        </>} />}
    </div>
    </div>
  </DetailsWorkspace>;
}
