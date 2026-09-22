import { useEffect, useRef, useState } from "react";
import { Input, Spin } from "antd";
import { Search, Server, Settings, UserRound } from "lucide-react";
import type { Account, AggregateApi, Provider } from "../../types";
import { maskAccountEmail } from "../../utils/accountPrivacy";
import { GuiAccountGroup, type GuiAccountChoice } from "./GuiAccountGroup";
import { GuiAccountMenu } from "./GuiAccountMenu";
import type { GuiComputerNavigation } from "./remote/types";
import { ProxyAccountSummary } from "./ProxyAccountSummary";
import { GuiAutoSwitchSettingsDialog } from "./GuiAutoSwitchSettingsDialog";
import styles from "./ProxyAccountPicker.module.less";

export interface ProxyAccountPickerProps {
  active: boolean;
  computers?: GuiComputerNavigation;
  privacyMode: boolean;
  accounts: Account[];
  providers: Provider[];
  aggregateApis: AggregateApi[];
  proxyRunning: boolean;
  busy: boolean;
  loading: boolean;
  selectionError?: string;
  onSwitchAccount: (id: string) => Promise<boolean>;
  onSwitchProvider: (id: string) => Promise<boolean>;
}

export function ProxyAccountPicker(props: ProxyAccountPickerProps) {
  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const switching = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const provider = props.providers.find((entry) => entry.active);
  const aggregate = props.aggregateApis.find((entry) => entry.active);
  const account = props.accounts.find((entry) => entry.active);
  const thirdParty = Boolean(provider || aggregate);
  const email = account?.email && (props.privacyMode ? maskAccountEmail(account.email) : account.email);
  const name = aggregate?.name || provider?.name || email || "选择 GUI 账户";
  const disabled = props.busy || props.loading || saving || !props.proxyRunning;
  const matches = (choice: GuiAccountChoice) =>
    `${choice.name} ${choice.detail}`.toLowerCase().includes(query.trim().toLowerCase());
  // `official` describes account-pool provenance, not whether the account can use the official API.
  const accounts = props.accounts.map((entry) => ({
    id: entry.id, name: entry.email,
    detail: entry.plan, usage: entry.usage,
    selected: !thirdParty && entry.active, disabled: !entry.localProxyCompatible,
  })).filter(matches);
  const providers = props.providers.map((entry) => ({
    id: entry.id, name: entry.name, detail: entry.group || entry.model,
    selected: !aggregate && entry.active,
  })).filter(matches);
  useEffect(() => {
    if (!props.active) { setOpen(false); setSettingsOpen(false); }
  }, [props.active]);

  const select = async (id: string, switchAccount: (id: string) => Promise<boolean>) => {
    if (disabled || switching.current) return;
    switching.current = true;
    setSaving(true);
    setError("");
    try {
      if (await switchAccount(id)) { setOpen(false); trigger.current?.focus(); }
      else setError("切换未完成，请重试。");
    } catch { setError("切换未完成，请重试。"); }
    finally { switching.current = false; setSaving(false); }
  };
  const panel = <div onKeyDown={(event) => {
    if (event.key === "Escape") { event.stopPropagation(); setOpen(false); trigger.current?.focus(); }
  }}>
    <div className={styles.list} aria-busy={saving || props.loading}>
      <GuiAccountGroup title="官方账号" choices={accounts} disabled={disabled}
        onSelect={(id) => void select(id, props.onSwitchAccount)} />
      <GuiAccountGroup title="第三方 Provider" choices={providers} disabled={disabled}
        onSelect={(id) => void select(id, props.onSwitchProvider)} />
    </div>
    <div className={styles.footer}>
      <div className={styles.toolbar}>
        <Input className={styles.search} size="small" prefix={<Search size={13} />}
          placeholder="搜索账号或 Provider" aria-label="搜索账号或 Provider"
          value={query} allowClear onChange={(event) => setQuery(event.target.value)} />
        <div className={styles.actions}>
          {(saving || props.loading) && <Spin size="small" />}
          <button type="button" className={styles.settings} aria-label="Codex GUI 设置" aria-haspopup="dialog"
            disabled={saving || props.loading}
            onClick={() => { setOpen(false); setSettingsOpen(true); }}><Settings size={16} /></button>
        </div>
      </div>
      {!props.proxyRunning && <p className={styles.hint}>开启本地代理后，即可在这里切换。</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      {props.selectionError && <p className={styles.error} role="alert">{props.selectionError}</p>}
    </div>
  </div>;
  return <><GuiAccountMenu active={props.active} open={open} name={name} trigger={trigger}
    computers={props.computers} busy={saving} accounts={panel}
    icon={saving ? <Spin size="small" /> : thirdParty ? <Server size={17} /> : <UserRound size={17} />}
    summary={<ProxyAccountSummary name={name} account={account} provider={aggregate ? undefined : provider}
      thirdParty={thirdParty} running={props.proxyRunning} active={props.active} />}
    onOpenChange={(next) => { setOpen(next); if (next) { setQuery(""); setError(""); } }} />
    {settingsOpen && props.active && <GuiAutoSwitchSettingsDialog accounts={props.accounts} providers={props.providers}
      privacyMode={props.privacyMode} onClose={() => { setSettingsOpen(false); trigger.current?.focus(); }} />}
  </>;
}
