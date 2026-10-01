import { guiText } from "../../i18n/guiText";
import { useState } from "react";
import { Button, InputNumber, Modal, Select, Spin, Switch, Tabs } from "antd";
import type { Account, Provider } from "../../types";
import { accountExpirationDate } from "../../utils/expiration";
import { maskAccountEmail } from "../../utils/accountPrivacy";
import {
  guiAccountRule, MAX_AUTO_SWITCH_PRIORITY, MAX_REMAINING_PERCENT, MIN_AUTO_SWITCH_PRIORITY,
} from "./autoSwitchSettings";
import type { GuiAutoSwitchAccountRule, GuiAutoSwitchSettings } from "./autoSwitchSettings";
import { useGuiAutoSwitchSettings } from "./useGuiAutoSwitchSettings";
import { GuiAccountUsage } from "./GuiAccountUsage";
import { GuiAppearanceSettings } from "./GuiAppearanceSettings";
import { GuiThemeSettings } from "./GuiThemeSettings";
import { GuiSkinSettings } from "./GuiSkinSettings";
import { GuiSystemPromptSettings } from "./GuiSystemPromptSettings";
import styles from "./GuiAutoSwitchSettingsDialog.module.less";

type SettingsEditor = ReturnType<typeof useGuiAutoSwitchSettings>;
type ProviderChoice = Pick<Provider, "id" | "name">;
type FieldsProps = { settings: GuiAutoSwitchSettings; editor: SettingsEditor; providers: ProviderChoice[] };

function fallbackProviderChoices(providers: ProviderChoice[], selected: string | null) {
  const options = providers.map((provider) => ({ value: provider.id, label: provider.name }));
  if (!selected || providers.some((provider) => provider.id === selected)) return options;
  return [...options, { value: selected, label: guiText("原备用 Provider 已不可用"), disabled: true }];
}

function GeneralSettings({ settings, editor, providers }: FieldsProps) {
  const disabled = editor.saving || !settings.enabled;
  return <div className={styles.fields}>
    <div className={styles.row}>
      <span>{guiText("自动切换账号")}</span>
      <Switch size="small" aria-label={guiText("自动切换账号")} checked={settings.enabled} disabled={editor.saving}
        onChange={(enabled) => editor.update({ enabled })} />
    </div>
    <div className={styles.row}>
      <span>{guiText("额度耗尽后切换")}</span>
      <Switch size="small" aria-label={guiText("额度耗尽后切换")} checked={settings.switchOnQuotaExhaustion} disabled={disabled}
        onChange={(switchOnQuotaExhaustion) => editor.update({ switchOnQuotaExhaustion })} />
    </div>
    <div className={styles.row}>
      <label htmlFor="gui-auto-switch-threshold">{guiText("默认剩余额度阈值")}</label>
      <InputNumber id="gui-auto-switch-threshold" aria-label={guiText("默认剩余额度阈值")} size="small" suffix="%"
        min={0} max={MAX_REMAINING_PERCENT} precision={1} value={settings.minimumRemainingPercent}
        disabled={disabled} onChange={(value) => editor.update({ minimumRemainingPercent: value ?? 0 })} />
      <p className={styles.hint}>{guiText("主额度剩余低于阈值时换号；账号阈值更高时，以较高值为准。")}</p>
    </div>
    <div className={styles.row}>
      <label htmlFor="gui-auto-switch-mode">{guiText("分配方式")}</label>
      <Select id="gui-auto-switch-mode" aria-label={guiText("分配方式")} size="small" value={settings.mode} disabled={disabled}
        options={[{ value: "sequential", label: guiText("顺序切换") }, { value: "concurrent", label: guiText("并发分配") }]}
        onChange={(mode: GuiAutoSwitchSettings["mode"]) => editor.update({ mode })} />
      <p className={styles.hint}>{settings.mode === "concurrent"
        ? guiText("不同会话优先分配不同账号，已有会话继续使用原账号。") : guiText("优先使用当前账号，换号时按优先级选择。")}</p>
    </div>
    <div className={styles.row}>
      <label htmlFor="gui-auto-switch-provider">{guiText("备用 Provider")}</label>
      <Select id="gui-auto-switch-provider" aria-label={guiText("备用 Provider")} size="small" allowClear placeholder={guiText("不使用备用 Provider")}
        value={settings.fallbackProviderId ?? undefined} disabled={disabled}
        options={fallbackProviderChoices(providers, settings.fallbackProviderId)}
        onChange={(id: string | undefined) => editor.update({ fallbackProviderId: id ?? null })} />
      <p className={styles.hint}>{guiText("无可用账号时使用备用 Provider；手动选择的 Provider 保持不变。")}</p>
    </div>
  </div>;
}

function AccountRule({ account, rule, disabled, onChange }: {
  account: Pick<Account, "email" | "expiresAt" | "localProxyCompatible" | "usage">; rule: GuiAutoSwitchAccountRule;
  disabled: boolean; onChange: (rule: GuiAutoSwitchAccountRule) => void;
}) {
  const unavailable = disabled || !account.localProxyCompatible;
  return <tr className={styles.account}>
    <td><span className={styles.email} title={account.email}>{account.email}</span></td>
    <td className={styles.expiration}>{accountExpirationDate(account.expiresAt, account.usage.apiExpiresAt)
      ?? guiText("未知")}</td>
    <td><GuiAccountUsage usage={account.usage.primary} label={guiText("主用量")} /></td>
    <td><GuiAccountUsage usage={account.usage.secondary} label={guiText("次用量")} /></td>
    <td>
      <Switch size="small" aria-label={guiText("{value1} 参与自动切换", { value1: account.email })} checked={rule.enabled}
        disabled={unavailable} onChange={(enabled) => onChange({ ...rule, enabled })} />
    </td>
    {account.localProxyCompatible ? <>
      <td>
        <InputNumber size="small" aria-label={guiText("{value1} 优先级", { value1: account.email })} value={rule.priority}
          min={MIN_AUTO_SWITCH_PRIORITY} max={MAX_AUTO_SWITCH_PRIORITY} precision={0}
          disabled={unavailable || !rule.enabled} onChange={(value) => onChange({ ...rule, priority: value ?? 0 })} />
      </td>
      <td>
        <InputNumber size="small" aria-label={guiText("{value1} 剩余阈值", { value1: account.email })} value={rule.thresholdPercent}
          min={0} max={MAX_REMAINING_PERCENT} precision={1} suffix="%" disabled={unavailable || !rule.enabled}
          onChange={(value) => onChange({ ...rule, thresholdPercent: value ?? 0 })} />
      </td>
    </> : <td colSpan={2} className={styles.hint}>{guiText("此账号暂不支持代理")}</td>}
  </tr>;
}

function AccountSettings({ settings, editor, accounts, privacyMode }: {
  settings: GuiAutoSwitchSettings; editor: SettingsEditor; accounts: Account[]; privacyMode: boolean;
}) {
  return <section className={styles.accounts} aria-label={guiText("参与自动切换的账号")}>
    <div className={styles.heading}>
      <h3>{guiText("参与自动切换的账号")}</h3>
      <p className={styles.hint}>{guiText("新增账号默认参与。优先级越小越优先；相同时，先用主额度剩余较少的账号。")}</p>
    </div>
    {accounts.length ? <div className={styles.accountTableScroll}>
      <table className={styles.accountTable} aria-label={guiText("参与自动切换的账号")}>
        <colgroup><col /><col className={styles.expirationColumn} />
          <col className={styles.usageColumn} /><col className={styles.usageColumn} />
          <col className={styles.participationColumn} />
          <col className={styles.numberColumn} /><col className={styles.numberColumn} /></colgroup>
        <thead><tr><th scope="col">{guiText("账号")}</th>
          <th scope="col">{guiText("有效期")}</th><th scope="col">{guiText("主用量")}</th><th scope="col">{guiText("次用量")}</th>
          <th scope="col">{guiText("参与切换")}</th>
          <th scope="col">{guiText("优先级")}</th><th scope="col">{guiText("剩余阈值")}</th></tr></thead>
        <tbody>{accounts.map((account) => <AccountRule key={account.id}
          account={{ email: privacyMode ? maskAccountEmail(account.email) : account.email,
            expiresAt: account.expiresAt, localProxyCompatible: account.localProxyCompatible, usage: account.usage }}
          rule={guiAccountRule(settings, account.id)} disabled={editor.saving || !settings.enabled}
          onChange={editor.updateAccount} />)}</tbody>
      </table>
    </div> : <p className={styles.hint}>{guiText("暂无可用账号")}</p>}
  </section>;
}

export function GuiAutoSwitchSettingsDialog({ accounts, providers, privacyMode, onClose }: {
  accounts: Account[]; providers: ProviderChoice[]; privacyMode: boolean; onClose: () => void;
}) {
  const editor = useGuiAutoSwitchSettings();
  const [tab, setTab] = useState("accounts");
  const save = async () => {
    if (await editor.save(accounts.map((account) => account.id))) onClose();
    else setTab("accounts");
  };
  return <Modal open centered width="80vw" className={styles.dialog}
    title={<div className={styles.heading}>
      <span>{guiText("Codex GUI 设置")}</span><p className={styles.hint}>{guiText("按你的习惯调整 Codex GUI。")}</p>
    </div>}
    onCancel={onClose} closable={!editor.saving} maskClosable={!editor.saving} keyboard={!editor.saving}
    footer={tab !== "accounts" && !editor.dirty ? <Button onClick={onClose}>{guiText("完成")}</Button> : <>
      <Button disabled={editor.saving} onClick={onClose}>{guiText("取消")}</Button>
      <Button type="primary" loading={editor.saving} disabled={editor.loading || !editor.settings}
        onClick={() => void save()}>{guiText("保存")}</Button>
    </>}>
    <Tabs activeKey={tab} onChange={setTab} className={styles.tabs} items={[
      { key: "accounts", label: guiText("自动切号"), disabled: editor.saving, children: <div className={styles.accountPanel}>
        {editor.loading && <div className={styles.loading} role="status"><Spin size="small" />{guiText("正在读取设置…")}</div>}
        {editor.error && <div className={styles.error} role="alert">
          <span>{editor.error}</span>
          {!editor.settings && <Button size="small" disabled={editor.loading}
            onClick={() => void editor.load()}>{guiText("重试")}</Button>}
        </div>}
        {editor.settings && <>
          <GeneralSettings settings={editor.settings} editor={editor} providers={providers} />
          <AccountSettings settings={editor.settings} editor={editor} accounts={accounts} privacyMode={privacyMode} />
        </>}
      </div> },
      { key: "appearance", label: guiText("界面"), disabled: editor.saving, children: <GuiAppearanceSettings /> },
      { key: "systemPrompts", label: guiText("系统提示词"), disabled: editor.saving,
        children: <GuiSystemPromptSettings /> },
      { key: "theme", label: guiText("主题"), disabled: editor.saving, children: <GuiThemeSettings /> },
      { key: "skin", label: guiText("皮肤"), disabled: editor.saving, children: tab === "skin" && <GuiSkinSettings /> },
    ]} />
  </Modal>;
}
