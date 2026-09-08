import { useEffect, useRef, useState } from "react";
import { Input, Popover, Spin } from "antd";
import { Check, ChevronsUpDown, Search, Server, UserRound } from "lucide-react";
import type { Account, AggregateApi, Provider } from "../../types";
import { ProxyAccountDetails } from "./ProxyAccountDetails";
import styles from "./ProxyAccountPicker.module.less";

export interface ProxyAccountPickerProps {
  active: boolean;
  accounts: Account[];
  providers: Provider[];
  aggregateApis: AggregateApi[];
  proxyRunning: boolean;
  busy: boolean;
  loading: boolean;
  onSwitchAccount: (id: string) => Promise<boolean>;
  onSwitchProvider: (id: string) => Promise<boolean>;
}

type Choice = {
  id: string; name: string; detail: string; selected: boolean; disabled?: boolean; usage?: Account["usage"];
};

function AccountGroup({ title, choices, onSelect, disabled }: {
  title: string; choices: Choice[]; onSelect: (id: string) => void; disabled: boolean;
}) {
  return <section className={styles.group} aria-label={title}>
    <h3>{title}</h3>
    {choices.length ? choices.map((choice) => <button key={choice.id} type="button"
      className={`${styles.option} ${choice.selected ? styles.selected : ""}`}
      aria-pressed={choice.selected} disabled={disabled || choice.disabled}
      onClick={() => { if (!choice.selected) onSelect(choice.id); }}>
      <span>
        <span>{choice.name}</span>
        {choice.usage ? <ProxyAccountDetails plan={choice.detail} usage={choice.usage} />
          : choice.detail && <small>{choice.detail}</small>}
        {choice.disabled && <small>此账号暂不支持代理</small>}
      </span>
      {choice.selected && <Check size={15} aria-label="当前使用" />}
    </button>) : <p className={styles.hint}>暂无匹配项</p>}
  </section>;
}

export function ProxyAccountPicker(props: ProxyAccountPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const switching = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const provider = props.providers.find((entry) => entry.active && entry.kind === "custom");
  const aggregate = props.aggregateApis.find((entry) => entry.active);
  const account = props.accounts.find((entry) => entry.active);
  const thirdParty = Boolean(provider || aggregate);
  const name = aggregate?.name || provider?.name || account?.email || "选择代理账户";
  const category = thirdParty ? "第三方 Provider" : "官方账号";
  const subtitle = props.proxyRunning ? category : "代理未启动";
  const disabled = props.busy || props.loading || saving || !props.proxyRunning;
  const matches = (choice: Choice) => `${choice.name} ${choice.detail}`.toLowerCase().includes(query.trim().toLowerCase());
  // `official` describes account-pool provenance, not whether the account can use the official API.
  const accounts = props.accounts.map((entry) => ({
    id: entry.id, name: entry.email,
    detail: entry.plan, usage: entry.usage,
    selected: !thirdParty && entry.active, disabled: !entry.localProxyCompatible,
  })).filter(matches);
  const providers = props.providers.filter((entry) => entry.kind === "custom").map((entry) => ({
    id: entry.id, name: entry.name, detail: entry.group || entry.model,
    selected: !aggregate && entry.active,
  })).filter(matches);
  useEffect(() => { if (!props.active) setOpen(false); }, [props.active]);

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
  const panel = <div className={styles.panel} onKeyDown={(event) => {
    if (event.key === "Escape") { event.stopPropagation(); setOpen(false); trigger.current?.focus(); }
  }}>
    <div className={styles.header}>
      <div className={styles.heading}><strong>切换代理账户</strong>{(saving || props.loading) && <Spin size="small" />}</div>
      <Input size="small" prefix={<Search size={13} />} placeholder="搜索账号或 Provider" aria-label="搜索账号或 Provider"
        value={query} allowClear onChange={(event) => setQuery(event.target.value)} />
      {!props.proxyRunning && <p className={styles.hint}>开启本地代理后，即可在这里切换。</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
    </div>
    <div className={styles.list} aria-busy={saving || props.loading}>
      <AccountGroup title="官方账号" choices={accounts} disabled={disabled}
        onSelect={(id) => void select(id, props.onSwitchAccount)} />
      <AccountGroup title="第三方 Provider" choices={providers} disabled={disabled}
        onSelect={(id) => void select(id, props.onSwitchProvider)} />
    </div>
  </div>;
  return <Popover trigger="click" placement="topLeft" open={open && props.active} content={panel}
    styles={{ root: { maxWidth: 400 }, body: { padding: 0, overflow: "hidden" } }} onOpenChange={(next) => {
      setOpen(next); if (next) { setQuery(""); setError(""); }
    }}>
    <button ref={trigger} type="button" className={styles.trigger} aria-expanded={open && props.active}
      aria-label={`切换代理账户：${name}`}>
      {saving ? <Spin size="small" /> : thirdParty ? <Server size={17} /> : <UserRound size={17} />}
      <span className={styles.current}><span>{name}</span><small>{subtitle}</small></span>
      <ChevronsUpDown size={14} />
    </button>
  </Popover>;
}
