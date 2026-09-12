import { lazy, Suspense, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Alert, Button, Popover, Tooltip } from "antd";
import { Download, PanelBottom, PanelLeftClose, PanelLeftOpen, RefreshCw } from "lucide-react";
import { hasLocalBackend, isDesktopApp } from "../api/backend";
import { getGuiController, retainGuiSession } from "./codexGui/session";
import { canEditMessage } from "./codexGui/editMessage";
import { ThreadSidebar, threadTitle } from "./codexGui/ThreadSidebar";
import { Composer, type ComposerHandle } from "./codexGui/Composer";
import { Messages } from "./codexGui/Messages";
import { Approvals } from "./codexGui/Approvals";
import { AsyncQuestions } from "./codexGui/AsyncQuestions";
import { Installer } from "./codexGui/Installer";
import { useCliInstaller } from "./codexGui/useCliInstaller";
import { DetailsWorkspace } from "./codexGui/DetailsWorkspace";
import { ConversationChangesButton } from "./codexGui/ConversationChangesButton";
import { useGuiLayout } from "./codexGui/useGuiLayout";
import { useConversationReadState } from "./codexGui/useConversationReadState";
import styles from "./codexGui/styles.module.less";
import { WorkspaceOperationContext } from "./codexGui/workspaceOperationContext";
import type { AggregateApi, Provider } from "../types";
import { providerModels } from "./codexGui/providerModels";
import { useDreamSkin } from "./codexGui/useDreamSkin";
import { guiComposer } from "./codexGui/composerBridge";
import { FocusModeButton, type GuiFocusMode } from "./codexGui/FocusModeButton";
import { useTerminalPanel } from "./codexGui/terminal/useTerminalPanel";
import { MobileConnectionStatus } from "./codexGui/MobileConnectionStatus";

const TerminalPanel = lazy(() => import("./codexGui/terminal/TerminalPanel"));

type CodexGuiPageProps = {
  active: boolean; accountPicker: ReactNode; providers: Provider[]; aggregateApis: AggregateApi[];
  windowControls?: ReactNode;
};

export function CodexGuiPage(props: CodexGuiPageProps) {
  const { active } = props;
  const models = useMemo(() => providerModels(props.providers, props.aggregateApis),
    [props.providers, props.aggregateApis]);
  useEffect(() => { guiComposer.setProviderModels(models); }, [models]);
  const focusMode = useGuiLayout(active);
  const [visited, setVisited] = useState(active);
  useEffect(() => { if (active) setVisited(true); }, [active]);
  if (!visited) return null;
  if (!hasLocalBackend) return <div className={styles.install}><h2>Codex GUI</h2><p>请打开 Codex Switch 提供的网页地址，开始对话。</p></div>;
  return <Workspace {...props} {...focusMode} />;
}

function Workspace({ active, accountPicker, providers, aggregateApis, windowControls,
  focused, onToggleFocus }: CodexGuiPageProps & GuiFocusMode) {
  const skinStyle = useDreamSkin(active);
  const [controller] = useState(getGuiController);
  useConversationReadState(active, controller);
  const composer = useRef<ComposerHandle>(null);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [collapsed, setCollapsed] = useState(() => window.innerWidth < 900);
  const installer = useCliInstaller(active, controller);
  useEffect(retainGuiSession, [controller]);
  const models = useMemo(() => providerModels(providers, aggregateApis), [providers, aggregateApis]);
  useEffect(() => { controller.setProviderModels(models); }, [controller, models]);
  useEffect(() => {
    if (isDesktopApp || !installer.version) return;
    if (active) void controller.connect();
    else controller.suspend();
  }, [active, controller, installer.version]);
  const current = state.selected ? state.conversations[state.selected] : undefined;
  const thread = current?.thread ?? state.threads.find((entry) => entry.id === state.selected);
  const terminal = useTerminalPanel(thread?.cwd ?? state.settings.cwd);
  const pending = state.approvals.filter((event) => event.params.threadId === state.selected);
  const otherApproval = state.approvals.find((event) => event.params.threadId !== state.selected);
  const running = state.sending || Object.values(state.conversations).some((value) => value.activeTurn);
  const canQuote = state.connection === "ready" && !state.sending && !state.archived
    && state.compacting !== state.selected;
  return <WorkspaceOperationContext.Provider value={{ busy: Boolean(state.workspaceBusy),
    setBusy: controller.setWorkspaceBusy }}><DetailsWorkspace selected={state.selected} active={active}>
    <div className={`${styles.page} ${collapsed ? styles.collapsed : ""}`}
      data-dream-skin={skinStyle ? "true" : undefined} style={skinStyle}>
    {!collapsed && <ThreadSidebar state={state} controller={controller} accountPicker={accountPicker}
      focused={focused} onToggleFocus={onToggleFocus} />}
    <div className={styles.workspace}>
      <header className={styles.header} data-tauri-drag-region={isDesktopApp || undefined}>
        <Button type="text" icon={collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          aria-label={collapsed ? "展开对话列表" : "收起对话列表"} onClick={() => setCollapsed(!collapsed)} />
        {collapsed && <FocusModeButton focused={focused} onToggleFocus={onToggleFocus} />}
        <div className={styles.heading} data-tauri-drag-region={isDesktopApp || undefined}>
          <strong data-tauri-drag-region={isDesktopApp || undefined}>{thread ? threadTitle(thread) : "Codex GUI"}</strong>
        </div>
        <div className={styles.headerActions} data-tauri-drag-region={isDesktopApp || undefined}>
          {isDesktopApp && <MobileConnectionStatus />}
          {installer.version && <Button type="text" icon={<RefreshCw size={16} />} aria-label="重新连接 Codex"
            disabled={Boolean(running)} loading={state.connection === "connecting"}
            onClick={() => void controller.connect()} />}
          <Popover trigger="click" placement="bottomRight"
            content={<Installer installer={installer} compact running={Boolean(running)} />}
            styles={{ root: { maxWidth: 400 } }}>
            <Button type="text" icon={<Download size={16} />}>
              {installer.version ? `v${installer.version}` : "Codex"}</Button>
          </Popover>
          {isDesktopApp && <Tooltip title={terminal.open ? "收起终端" : "打开终端"}
            styles={{ root: { maxWidth: 400 } }}>
            <Button type="text" icon={<PanelBottom size={16} />} aria-label={terminal.open ? "收起终端" : "打开终端"}
              aria-expanded={terminal.open} onClick={terminal.toggle} />
          </Tooltip>}
          <ConversationChangesButton value={current} />
        </div>
        {focused && windowControls && <div className={styles.focusWindowControls}>{windowControls}</div>}
      </header>
      {state.error && <Alert className={styles.error} message={state.error}
        type="error" closable onClose={controller.clearError} />}
      {state.computerUseSetup === "installing" && <Alert className={styles.error} type="info" showIcon
        message={<span style={{ display: "block", maxWidth: 400 }}>正在安装电脑助手，首次准备可能需要几分钟…</span>} />}
      {state.computerUseSetup === "failed" && <Alert className={styles.error} type="warning" showIcon closable
        message={<span style={{ display: "block", maxWidth: 400 }}>
          电脑助手安装未完成。你可以继续对话，稍后到社区插件页安装或修复电脑助手。
        </span>} />}
      {otherApproval && <button className={styles.pendingBanner}
        onClick={() => void controller.select(otherApproval.params.threadId!)}>另一个对话需要你的确认，点击查看</button>}
      {!installer.version ? <Installer installer={installer} /> :
        <Messages value={current} selected={state.selected} active={active}
          onEdit={controller.messageEditor.submit} editDisabled={!canEditMessage(state)}
          onQuote={canQuote ? (quote) => composer.current?.addQuote(quote) ?? false : undefined}
          pendingRequest={state.pendingRequest} footer={<>
          <Approvals events={pending} controller={controller} />
          <AsyncQuestions value={current} onAnswer={controller.answerAsyncQuestion}
            disabled={state.connection !== "ready" || state.sending || state.archived || Boolean(state.workspaceBusy)
              || Boolean(state.deleting) || state.compacting === state.selected} />
          <Composer ref={composer} state={state} controller={controller} active={active} />
        </>} />}
      {isDesktopApp && terminal.tabs.length > 0 && <Suspense fallback={null}>
        <TerminalPanel panel={terminal} active={active} />
      </Suspense>}
    </div>
    </div>
  </DetailsWorkspace></WorkspaceOperationContext.Provider>;
}
