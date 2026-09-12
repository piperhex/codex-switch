import type { ReactNode } from "react";
import type { Account, Provider } from "../../types";
import type { SkillsMarketPageProps } from "../skillsMarket/types";
import { CodexGuiPage } from "../CodexGuiPage";
import { ProxyAccountPicker } from "./ProxyAccountPicker";
import { useGuiAccountSelection } from "./useGuiAccountSelection";

export function GuiWorkspace(props: {
  active: boolean; accounts: Account[]; providers: Provider[]; privacyMode: boolean;
  proxyRunning: boolean; loading: boolean; windowControls?: ReactNode;
  plugins: Omit<SkillsMarketPageProps, "active">;
}) {
  const selection = useGuiAccountSelection(props);
  return <CodexGuiPage active={props.active} providers={selection.providers} aggregateApis={[]}
    windowControls={props.windowControls} plugins={props.plugins} accountPicker={
      <ProxyAccountPicker active={props.active} accounts={selection.accounts} providers={selection.providers}
        aggregateApis={[]} privacyMode={props.privacyMode} proxyRunning={props.proxyRunning}
        busy={false} loading={props.loading || selection.loading} selectionError={selection.error}
        onSwitchAccount={selection.switchAccount} onSwitchProvider={selection.switchProvider} />
    } />;
}
