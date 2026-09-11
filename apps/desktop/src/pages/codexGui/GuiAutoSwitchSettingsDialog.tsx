import { Button, InputNumber, Modal, Select, Spin, Switch } from "antd";
import type { Account, Provider } from "../../types";
import { maskAccountEmail } from "../../utils/accountPrivacy";
import {
  guiAccountRule, MAX_AUTO_SWITCH_PRIORITY, MAX_REMAINING_PERCENT, MIN_AUTO_SWITCH_PRIORITY,
} from "./autoSwitchSettings";
import type { GuiAutoSwitchAccountRule, GuiAutoSwitchSettings } from "./autoSwitchSettings";
import { useGuiAutoSwitchSettings } from "./useGuiAutoSwitchSettings";
import styles from "./GuiAutoSwitchSettingsDialog.module.less";

type SettingsEditor = ReturnType<typeof useGuiAutoSwitchSettings>;
type ProviderChoice = Pick<Provider, "id" | "name">;
type FieldsProps = { settings: GuiAutoSwitchSettings; editor: SettingsEditor; providers: ProviderChoice[] };

function fallbackProviderChoices(providers: ProviderChoice[], selected: string | null) {
  const options = providers.map((provider) => ({ value: provider.id, label: provider.name }));
  if (!selected || providers.some((provider) => provider.id === selected)) return options;
  return [...options, { value: selected, label: "原备用 Provider 已不可用", disabled: true }];
}

function GeneralSettings({ settings, editor, providers }: FieldsProps) {
  const disabled = editor.saving || !settings.enabled;
  return <div className={styles.fields}>
    <div className={styles.row}>
      <span>自动切换账号</span>
      <Switch size="small" aria-label="自动切换账号" checked={settings.enabled} disabled={editor.saving}
        onChange={(enabled) => editor.update({ enabled })} />
    </div>
    <div className={styles.row}>
      <span>额度耗尽后切换</span>
      <Switch size="small" aria-label="额度耗尽后切换" checked={settings.switchOnQuotaExhaustion} disabled={disabled}
        onChange={(switchOnQuotaExhaustion) => editor.update({ switchOnQuotaExhaustion })} />
    </div>
    <div className={styles.row}>
      <label htmlFor="gui-auto-switch-threshold">默认剩余额度阈值</label>
      <InputNumber id="gui-auto-switch-threshold" aria-label="默认剩余额度阈值" size="small" suffix="%"
        min={0} max={MAX_REMAINING_PERCENT} precision={1} value={settings.minimumRemainingPercent}
        disabled={disabled} onChange={(value) => editor.update({ minimumRemainingPercent: value ?? 0 })} />
    </div>
    <p className={styles.hint}>主额度剩余低于阈值时换号；账号单独设置的阈值更高时，以较高值为准。</p>
    <div className={styles.row}>
      <label htmlFor="gui-auto-switch-mode">分配方式</label>
      <Select id="gui-auto-switch-mode" aria-label="分配方式" size="small" value={settings.mode} disabled={disabled}
        options={[{ value: "sequential", label: "顺序切换" }, { value: "concurrent", label: "并发分配" }]}
        onChange={(mode: GuiAutoSwitchSettings["mode"]) => editor.update({ mode })} />
    </div>
    <p className={styles.hint}>{settings.mode === "concurrent"
      ? "不同会话优先分配不同账号，已有会话继续使用原账号。" : "优先使用当前账号，需要换号时按优先级选择。"}</p>
    <label className={styles.providerField}>
      <span>备用 Provider</span>
      <Select aria-label="备用 Provider" size="small" allowClear placeholder="不使用备用 Provider"
        value={settings.fallbackProviderId ?? undefined} disabled={disabled}
        options={fallbackProviderChoices(providers, settings.fallbackProviderId)}
        onChange={(id: string | undefined) => editor.update({ fallbackProviderId: id ?? null })} />
    </label>
    <p className={styles.hint}>没有可用账号时使用备用 Provider。手动选择的 Provider 会保持不变。</p>
  </div>;
}

function AccountRule({ account, rule, disabled, onChange }: {
  account: { email: string; localProxyCompatible: boolean }; rule: GuiAutoSwitchAccountRule;
  disabled: boolean; onChange: (rule: GuiAutoSwitchAccountRule) => void;
}) {
  const unavailable = disabled || !account.localProxyCompatible;
  return <div className={styles.account}>
    <div className={styles.row}>
      <span className={styles.email}>{account.email}</span>
      <Switch size="small" aria-label={`${account.email} 参与自动切换`} checked={rule.enabled}
        disabled={unavailable} onChange={(enabled) => onChange({ ...rule, enabled })} />
    </div>
    {account.localProxyCompatible ? <div className={styles.accountFields}>
      <label><span>优先级</span>
        <InputNumber size="small" aria-label={`${account.email} 优先级`} value={rule.priority}
          min={MIN_AUTO_SWITCH_PRIORITY} max={MAX_AUTO_SWITCH_PRIORITY} precision={0}
          disabled={unavailable || !rule.enabled} onChange={(value) => onChange({ ...rule, priority: value ?? 0 })} />
      </label>
      <label><span>剩余阈值</span>
        <InputNumber size="small" aria-label={`${account.email} 剩余阈值`} value={rule.thresholdPercent}
          min={0} max={MAX_REMAINING_PERCENT} precision={1} suffix="%" disabled={unavailable || !rule.enabled}
          onChange={(value) => onChange({ ...rule, thresholdPercent: value ?? 0 })} />
      </label>
    </div> : <p className={styles.hint}>此账号暂不支持代理</p>}
  </div>;
}

function AccountSettings({ settings, editor, accounts, privacyMode }: {
  settings: GuiAutoSwitchSettings; editor: SettingsEditor; accounts: Account[]; privacyMode: boolean;
}) {
  return <section className={styles.accounts} aria-label="参与自动切换的账号">
    <h3>参与自动切换的账号</h3>
    <p className={styles.hint}>新增账号默认参与。优先级数值越小越优先；相同时，先用主额度剩余较少的账号。</p>
    {accounts.length ? accounts.map((account) => <AccountRule key={account.id}
      account={{ email: privacyMode ? maskAccountEmail(account.email) : account.email,
        localProxyCompatible: account.localProxyCompatible }}
      rule={guiAccountRule(settings, account.id)} disabled={editor.saving || !settings.enabled}
      onChange={editor.updateAccount} />) : <p className={styles.hint}>暂无可用账号</p>}
  </section>;
}

export function GuiAutoSwitchSettingsDialog({ accounts, providers, privacyMode, onClose }: {
  accounts: Account[]; providers: ProviderChoice[]; privacyMode: boolean; onClose: () => void;
}) {
  const editor = useGuiAutoSwitchSettings();
  const save = async () => { if (await editor.save(accounts.map((account) => account.id))) onClose(); };
  return <Modal open centered title="GUI 自动切号设置" width={400} className={styles.dialog}
    style={{ maxWidth: "min(400px, calc(100vw - 24px))" }}
    onCancel={onClose} closable={!editor.saving} maskClosable={!editor.saving} keyboard={!editor.saving}
    footer={<>
      <Button disabled={editor.saving} onClick={onClose}>取消</Button>
      <Button type="primary" loading={editor.saving} disabled={editor.loading || !editor.settings}
        onClick={() => void save()}>保存</Button>
    </>}>
    <p className={styles.intro}>仅用于 Codex GUI，设置单独保存。</p>
    {editor.loading && <div className={styles.loading} role="status"><Spin size="small" />正在读取设置…</div>}
    {editor.error && <div className={styles.error} role="alert">
      <span>{editor.error}</span>
      {!editor.settings && <Button size="small" disabled={editor.loading}
        onClick={() => void editor.load()}>重试</Button>}
    </div>}
    {editor.settings && <>
      <GeneralSettings settings={editor.settings} editor={editor} providers={providers} />
      <AccountSettings settings={editor.settings} editor={editor} accounts={accounts} privacyMode={privacyMode} />
    </>}
  </Modal>;
}
