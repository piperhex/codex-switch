import { useState } from "react";
import { Alert, Button, Checkbox, Input, InputNumber, Modal, Radio, Spin, Switch } from "antd";
import type { Translate } from "../../i18n";
import type { Account, AutoResetSettings } from "../../types";
import { useAutoResetSettings } from "./useAutoResetSettings";
import styles from "./AutoResetSettingsModal.module.less";

const MAX_RESET_CARDS = 100;

function accountEmail(email: string, privacyMode: boolean) {
  if (!privacyMode) return email;
  if (email.length <= 10) return "*****";
  return `${email.slice(0, 5)}*****${email.slice(-5)}`;
}

function AccountSelection({ accounts, settings, onChange, privacyMode, t }: {
  accounts: Account[];
  settings: AutoResetSettings;
  onChange: (settings: AutoResetSettings) => void;
  privacyMode: boolean;
  t: Translate;
}) {
  const [search, setSearch] = useState("");
  const selected = settings.accountIds;
  const visible = accounts.filter((account) => `${account.email} ${account.note} ${account.group}`
    .toLowerCase().includes(search.trim().toLowerCase()));
  return <div className={styles.selection}>
    <span className={styles.label}>{t("autoReset.accounts")}</span>
    <Radio.Group value={selected === null ? "all" : "custom"} onChange={(event) =>
      onChange({ ...settings, accountIds: event.target.value === "all" ? null : [] })}>
      <Radio value="all">{t("autoReset.allAccounts")}</Radio>
      <Radio value="custom">{t("autoReset.customAccounts")}</Radio>
    </Radio.Group>
    <p className={styles.hint}>{t("autoReset.accountHint")}</p>
    {selected !== null && <>
      <Input allowClear value={search} onChange={(event) => setSearch(event.target.value)}
        placeholder={t("autoReset.search")} aria-label={t("autoReset.search")} />
      <div className={styles.accounts}>
        {visible.map((account) => <Checkbox key={account.id} checked={selected.includes(account.id)}
          onChange={(event) => onChange({ ...settings, accountIds: event.target.checked
            ? [...selected, account.id] : selected.filter((id) => id !== account.id) })}>
          <span className={styles.email}>{accountEmail(account.email, privacyMode)}</span>
          {account.group && <span className={styles.hint}> · {account.group}</span>}
        </Checkbox>)}
        {!visible.length && <p className={styles.hint}>{t("autoReset.noAccounts")}</p>}
      </div>
      {!selected.length && <p className={styles.hint}>{t("autoReset.noneSelected")}</p>}
    </>}
  </div>;
}

export function AutoResetSettingsModal({ concurrent, onClose, t }: {
  concurrent: boolean;
  onClose: () => void;
  t: Translate;
}) {
  const form = useAutoResetSettings(onClose);
  const { settings, setSettings } = form;
  return <Modal open centered title={t("autoReset.title")} width={460}
    styles={{ body: { maxHeight: "calc(100vh - 180px)", overflowY: "auto" } }}
    onCancel={form.saving ? undefined : onClose}
    onOk={() => void form.save()} okText={t("autoReset.save")} cancelText={t("autoReset.cancel")}
    confirmLoading={form.saving} closable={!form.saving} maskClosable={!form.saving}
    cancelButtonProps={{ disabled: form.saving }} okButtonProps={{ disabled: !settings || form.loading }}>
    <div className={styles.content}>
      <p className={styles.hint}>{t("autoReset.description")}</p>
      {form.error && <Alert type="error" showIcon
        message={t(form.error === "load" ? "autoReset.loadError" : "autoReset.saveError")}
        action={form.error === "load" && <Button size="small" onClick={form.retry}>{t("reset.retry")}</Button>} />}
      {form.loading ? <Spin /> : settings && <fieldset disabled={form.saving} className={styles.fields}>
        <div className={styles.row}>
          <span>{t("autoReset.enabled")}</span>
          <Switch checked={settings.enabled} disabled={form.saving} aria-label={t("autoReset.enabled")}
            onChange={(enabled) => setSettings({ ...settings, enabled })} />
        </div>
        <div className={styles.row}>
          <label htmlFor="auto-reset-max">{t("autoReset.maxCards")}</label>
          <InputNumber id="auto-reset-max" min={1} max={MAX_RESET_CARDS} precision={0}
            value={settings.maxCards} disabled={form.saving}
            onChange={(value) => setSettings({ ...settings, maxCards: value ?? 1 })} />
        </div>
        <p className={styles.hint}>{t(concurrent ? "autoReset.concurrentHint" : "autoReset.singleHint")}</p>
        <div className={styles.row}>
          <label htmlFor="auto-reset-reserve">{t("autoReset.reserveCards")}</label>
          <InputNumber id="auto-reset-reserve" min={0} max={MAX_RESET_CARDS} precision={0}
            value={settings.reserveCards} disabled={form.saving}
            onChange={(value) => setSettings({ ...settings, reserveCards: value ?? 0 })} />
        </div>
        <p className={styles.hint}>{t("autoReset.reserveHint")}</p>
        <AccountSelection accounts={form.accounts} settings={settings} onChange={setSettings}
          privacyMode={form.privacyMode} t={t} />
      </fieldset>}
    </div>
  </Modal>;
}
