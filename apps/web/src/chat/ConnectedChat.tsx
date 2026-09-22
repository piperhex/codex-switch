import { t, useLanguage } from '../i18n';
import { useEffect, useState, type ReactNode } from 'react';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import type { ChatComputer } from '../../../../shared/remote-chat/devices';
import { ChatApproval } from './ChatApproval';
import { ChatComposer } from './ChatComposer';
import { queueProps } from '../../../../shared/remote-chat/client/queueProps';
import { ChatMessages } from './ChatMessages';
import { ChatProcessing } from './ChatProcessing';
import { ChatImageContext } from './ChatImage';
import { ChatFileContext } from './ChatFileLink';
import { ChatThreads } from './ChatThreads';
import { ChatSidebar } from './ChatSidebar';
import { useDesktopLayout, usePanelVisibility } from '../useDesktopLayout';
import { ChatDevices } from './ChatDevices';
import { ChatConnectionInfo } from './ChatConnectionInfo';
import { ChatQuotesProvider } from './ChatQuotes';
import { ChatAsyncQuestions } from './ChatAsyncQuestions';
import { ChatSearch } from './ChatSearch';
import { ChatProfileMenu } from './ChatProfileMenu';
import { ChatTokenSummary } from './ChatTokenSummary';
import { useChatCatalog } from './useChatCatalog';
import { compactUnavailableReason } from '../../../../shared/remote-chat/client/composerCommands';
import { threadPresentation } from '../../../../shared/remote-chat/sidebar';
import { useChatDrawerSwipe } from './useChatDrawerSwipe';
import type { ChatController, ChatProject, ChatState } from './types';
import './chat.css';

export interface ConnectedChatProps {
  chat: { state: ChatState; controller: ChatController; foreground: boolean };
  device?: ChatComputer; devices: ChatComputer[]; active: boolean;
  scope: string; email: string; chooseDevice: (id: string) => void;
  chooseLocal?: () => void; accountPicker?: ReactNode; headerActions?: ReactNode;
}

/** Conversation UI shared by the web client and the desktop's remote workspace. */
export function ConnectedChat({ chat, device, devices, active, scope, email, chooseDevice,
  chooseLocal, accountPicker, headerActions }: ConnectedChatProps) {
  useLanguage();
  const { state, controller, foreground } = chat;
  const [drawer, setDrawer] = useState(false);
  const desktop = useDesktopLayout();
  const [sidebar, setSidebar] = usePanelVisibility('chat-list');
  const listOpen = desktop ? sidebar : drawer;
  const ListToggleIcon = listOpen ? PanelLeftClose : PanelLeftOpen;
  const closeList = () => { if (desktop) setSidebar(false); else setDrawer(false); };
  const selectedFromList = () => { if (!desktop) setDrawer(false); };
  const [pickingDevice, setPickingDevice] = useState(false);
  const [searching, setSearching] = useState(false);
  const [tokenSummary, setTokenSummary] = useState(false);
  useChatDrawerSwipe({ enabled: active && !desktop && !pickingDevice && !searching && !tokenSummary,
    open: drawer, onOpenChange: setDrawer });
  const ready = state.ready;
  const cwd = state.selected?.cwd ?? state.draftProject?.cwd ?? '';
  const catalog = useChatCatalog(controller, cwd, ready);
  const runningTurn = state.selected?.turns?.find((turn) => turn.status === 'inProgress');
  const running = Boolean(runningTurn);
  const approvals = state.approvals.filter((event) => event.params.threadId === state.selected?.id);
  const newChat = (project?: ChatProject) => { if (!state.sending) { controller.back(project); setDrawer(false); } };
  useEffect(() => {
    controller.setViewing(active && foreground && (desktop || !drawer) && !pickingDevice && !searching && !tokenSummary);
  }, [active, foreground, desktop, drawer, pickingDevice, searching, tokenSummary, controller]);
  useEffect(() => {
    if (!active) { setDrawer(false); setPickingDevice(false); setSearching(false); setTokenSummary(false); }
  }, [active]);
  return <ChatQuotesProvider scope={state.selected?.id ?? null} sending={state.sending}
    enabled={active && !state.selectedArchived}>
    <div className="chat-conversation">
    <header className="chat-header">
      <button type="button" className="chat-back" aria-label={listOpen ? t("收起聊天列表") : t("打开聊天列表")}
        aria-expanded={listOpen} onClick={() => { if (desktop) setSidebar(!sidebar); else setDrawer(!drawer); }}>
        <ListToggleIcon size={21} /></button>
      <div className="chat-grow"><h2>{state.selected ? threadPresentation(state.selected, state.sidebar, t).title : t("新聊天")}</h2>
        <ChatConnectionInfo state={state} controller={controller} device={device} active={active}
          chooseDevice={() => setPickingDevice(true)} /></div>
      {state.selected && state.selectedArchived && <button type="button" className="chat-button"
        disabled={!ready || running}
        onClick={() => { void controller.archive().then(() => setDrawer(true)); }}>
        {t("恢复")}</button>}
      {headerActions}
    </header>
    {!!state.error && <p role="alert" className="chat-error">{t(state.error)}</p>}
    <ChatImageContext.Provider value={{ threadId: state.selected?.id ?? null, ready, load: controller.imagePreview }}>
      <ChatFileContext.Provider value={{ threadId: state.selected?.id ?? null, ready, client: controller.files,
        load: controller.textPreview }}>
      <ChatMessages key={state.selected?.id ?? 'new'} thread={state.selected} offline={!ready}
        loading={state.historyLoading} loadingMore={state.historyLoadingMore} hasMore={state.historyHasMore}
        loadOlder={() => controller.loadOlder()} />
      </ChatFileContext.Provider>
    </ChatImageContext.Provider>
    {runningTurn && <ChatProcessing key={runningTurn.id} turn={runningTurn}
      processing={state.processing} active={active && ready} />}
    {!!approvals.length && <div className="chat-approvals chat-scroll">
      {approvals.map((event) => <ChatApproval key={String(event.id)} event={event}
        ready={ready} respond={(reply) => controller.respond(reply)} />)}
    </div>}
    <ChatAsyncQuestions thread={state.selected} error={state.error}
      scope={scope}
      disabled={!ready || state.sending || state.settingsBusy || state.selectedArchived || state.queueBusy
        || state.compacting === state.selected?.id} answer={controller.answerAsyncQuestion} />
    <ChatComposer queue={queueProps(state, controller)}
      goals={controller.goals} goal={state.selected ? state.goals?.[state.selected.id] : null} goalBusy={!!state.goalBusy}
      contextSettings={controller.contextSettings} cwd={cwd} catalog={catalog}
      compactReason={compactUnavailableReason(state)} compacting={!!state.compacting
        && state.compacting === state.selected?.id} compact={controller.compact}
      loadCatalog={controller.loadComposerCatalog} loadFiles={controller.loadProjectFiles}
      uploadProgress={state.upload}
      threadId={state.selected?.id ?? null} models={state.models} selection={state.settings}
      readUsage={controller.readUsage} tokenUsage={state.selected?.tokenUsage}
      settingsBusy={state.settingsBusy} settingsError={state.settingsError}
      updateSettings={(settings) => controller.setSettings(settings)}
      active={active} ready={ready && !state.selectedArchived} sending={state.sending} running={running}
      interrupted={state.selected?.turns?.at(-1)?.status === 'interrupted'}
      send={(input) => controller.send(input)} interrupt={() => controller.interrupt()} />
    </div>
    <ChatSidebar desktop={desktop} open={listOpen} onClose={closeList}>
      <ChatThreads state={state} controller={controller} newChat={newChat} onClose={selectedFromList}
        openSearch={() => setSearching(true)} accountPicker={accountPicker} profile={!accountPicker && <ChatProfileMenu client={controller.guiAccounts}
          deviceName={device?.name ?? t("选择电脑")} email={email} ready={ready}
          chooseDevice={() => { setDrawer(false); setPickingDevice(true); }}
          openTokenSummary={() => { setDrawer(false); setTokenSummary(true); }} />} />
    </ChatSidebar>
    {searching && <ChatSearch state={state} controller={controller} onClose={() => setSearching(false)}
      select={thread => { setSearching(false); setDrawer(false); void controller.select(thread); }} />}
    {tokenSummary && <ChatTokenSummary read={controller.readTokenSummary} ready={ready}
      deviceName={device?.name} onClose={() => setTokenSummary(false)} />}
    {pickingDevice && <ChatDevices chooseLocal={chooseLocal} devices={devices} onClose={() => setPickingDevice(false)}
      choose={(id) => { chooseDevice(id); setPickingDevice(false); }} />}
  </ChatQuotesProvider>;
}
