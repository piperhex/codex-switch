import { lazy, Suspense, type ReactNode } from "react";
import { isDesktopApp } from "../../api/backend";
import type { Account, Provider } from "../../types";
import type { SkillsMarketPageProps } from "../skillsMarket/types";
import { CodexGuiPage } from "../CodexGuiPage";
import { ProxyAccountPicker } from "./ProxyAccountPicker";
import { useGuiAccountSelection } from "./useGuiAccountSelection";
import { useGuiComputers } from "./remote/useGuiComputers";
import { useGuiLayout } from "./useGuiLayout";

const RemoteGuiWorkspace = lazy(() => import('./remote/RemoteGuiWorkspace'));

export function GuiWorkspace(props: {
  active: boolean; accounts: Account[]; providers: Provider[]; privacyMode: boolean;
  proxyRunning: boolean; loading: boolean; windowControls?: ReactNode;
  plugins: Omit<SkillsMarketPageProps, "active">;
}) {
  const computers = useGuiComputers({ active: props.active, login: props.plugins.onLogin,
    identity: props.plugins.authenticated && props.plugins.baseUrl && props.plugins.currentUserId
      ? { baseUrl: props.plugins.baseUrl, userId: props.plugins.currentUserId } : null });
  const remote = isDesktopApp ? computers.current : null;
  const localActive = props.active && !remote;
  const focusMode = useGuiLayout(props.active);
  const selection = useGuiAccountSelection({ ...props, active: localActive });
  return <><div hidden={Boolean(remote)} style={{ height: '100%' }}>
    <CodexGuiPage active={localActive} focusMode={focusMode} providers={selection.providers} aggregateApis={[]}
    windowControls={props.windowControls} plugins={props.plugins} accountPicker={
      <ProxyAccountPicker active={localActive} computers={isDesktopApp ? computers : undefined}
        accounts={selection.accounts} providers={selection.providers}
        aggregateApis={[]} privacyMode={props.privacyMode} proxyRunning={props.proxyRunning}
        busy={false} loading={props.loading || selection.loading} selectionError={selection.error}
        onSwitchAccount={selection.switchAccount} onSwitchProvider={selection.switchProvider} />
    } /></div>
    {remote && computers.identity && <Suspense fallback={<p role="status">正在连接电脑…</p>}>
      <RemoteGuiWorkspace key={JSON.stringify([computers.identity, remote.deviceId])}
        active={props.active} device={remote} identity={computers.identity} computers={computers}
        privacyMode={props.privacyMode} focusMode={focusMode} windowControls={props.windowControls} />
    </Suspense>}
  </>;
}
