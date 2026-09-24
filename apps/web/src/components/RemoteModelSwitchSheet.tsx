import { t, useLanguage } from '../i18n';
import { useState } from 'react';
import { remoteModelOptions, type RemoteModelTarget } from '../../../../shared/remote-chat/modelTarget';
import { ChevronRight } from "lucide-react";
import type { AccountSummary, RemoteDevice, RemoteProviderSummary } from "../types";
import { AdaptiveSheet } from "./AdaptiveSheet";

interface RemoteModelSwitchSheetProps {
  device: RemoteDevice | null;
  accounts: AccountSummary[];
  providers: RemoteProviderSummary[];
  switchingAccountId: string | null;
  switchingProviderId: string | null;
  onClose: () => void;
  onSwitchAccount: (deviceId: string, accountId: string, target: RemoteModelTarget) => Promise<boolean>;
  onSwitchProvider: (deviceId: string, providerId: string, target: RemoteModelTarget) => Promise<boolean>;
  onSwitchProviderGroup: (deviceId: string, group: string) => Promise<boolean>;
}

export function RemoteModelSwitchSheet({
  device,
  accounts,
  providers,
  switchingAccountId,
  switchingProviderId,
  onClose,
  onSwitchAccount,
  onSwitchProvider,
  onSwitchProviderGroup,
}: RemoteModelSwitchSheetProps) {
  useLanguage();
  const [target, setTarget] = useState<RemoteModelTarget>('proxy');
  const busy = Boolean(switchingAccountId || switchingProviderId);
  const options = remoteModelOptions(device, target);
  const { supported: providerSupported, providerAvailable, groupSupported } = options;
  const groups = target === 'gui' ? [] : [...new Set(providers.map((provider) => provider.group).filter(Boolean))];

  const selectAccount = async (accountId: string) => {
    if (!device?.online || busy || !options.accountAvailable) return;
    if (await onSwitchAccount(device.deviceId, accountId, target)) onClose();
  };
  const selectProvider = async (providerId: string) => {
    if (!device?.online || busy || !providerAvailable) return;
    if (await onSwitchProvider(device.deviceId, providerId, target)) onClose();
  };
  const selectProviderGroup = async (group: string) => {
    if (!device?.online || busy || !providerAvailable || !groupSupported) return;
    if (await onSwitchProviderGroup(device.deviceId, group)) onClose();
  };

  return <AdaptiveSheet open={Boolean(device)} title={t("切换模型")}
    subtitle={device ? t("{value1} · 选择这台 PC 使用的模型来源", { value1: device.name }) : undefined}
    width={440} onClose={() => { if (!busy) onClose(); }}>
    <div className="model-switch-target" role="group" aria-label={t("切换目标")}>
      <button type="button" aria-pressed={target === 'proxy'} disabled={busy}
        onClick={() => setTarget('proxy')}>{t("代理接口模型")}</button>
      <button type="button" aria-pressed={target === 'gui'} disabled={busy}
        onClick={() => setTarget('gui')}>{t("Codex GUI 模型")}</button>
    </div>
    <p className="model-switch-description">{target === 'gui'
      ? t("仅切换 Codex GUI 使用的模型来源。") : t("仅切换代理接口使用的模型来源。")}</p>
    {target === 'gui' && !providerSupported
      ? <p className="model-switch-empty" role="status">{t("请先更新 PC 端，再切换 Codex GUI 模型。")}</p> : null}
    <div className="model-switch-section">
      <h3>{t("官方模型")}</h3>
      {!accounts.length ? <p className="model-switch-empty">{t("暂无已同步的官方账号。")}</p>
        : <div className="select-list account-select-list">{accounts.map((account) => {
          const current = !options.providerId && !options.group && options.accountId === account.id;
          return <button type="button" disabled={busy || !device?.online || !options.accountAvailable || current}
            key={`account:${account.id}`} onClick={() => void selectAccount(account.id)}>
            <span className="account-initial">O</span><span><strong>{account.email}</strong>
              <small>{t("官方模型 ·")} {account.plan || "ChatGPT"}</small></span>
            {switchingAccountId === account.id
              ? <span className="model-switch-loading">{t("切换中")}</span>
              : current ? <b className="current-pill">{t("当前")}</b> : <ChevronRight size={18} />}
          </button>;
        })}</div>}
    </div>

    <div className="model-switch-section">
      <div className="model-switch-heading"><h3>{t("第三方 Provider")}</h3>
        {!providerSupported ? <span>{t("请先更新 PC 端")}</span>
          : !providerAvailable ? <span>{t("请先在 PC 端启动本地代理")}</span> : null}</div>
      {!providers.length ? <p className="model-switch-empty">{t("暂无已同步的第三方 Provider。")}</p>
        : <div className="select-list account-select-list">
          {groups.map((group) => {
            const count = providers.filter((provider) => provider.group === group).length;
            const current = device?.activeProviderGroup === group;
            return <button type="button" disabled={busy || !device?.online || !providerAvailable
              || !groupSupported || current} key={`group:${group}`}
              onClick={() => void selectProviderGroup(group)}>
              <span className="account-initial provider-initial">G</span><span>
                <strong>{group}</strong><small>{t("同时启用")} {count}  {t("个 API")}</small></span>
              {switchingProviderId === `group:${group}`
                ? <span className="model-switch-loading">{t("切换中")}</span>
                : current ? <b className="current-pill">{t("当前分组")}</b> : <ChevronRight size={18} />}
            </button>;
          })}
          {providers.map((provider) => {
            const current = options.providerId === provider.id;
            return <button type="button"
              disabled={busy || !device?.online || !providerAvailable || current}
              key={`provider:${provider.id}`} onClick={() => void selectProvider(provider.id)}>
              <span className="account-initial provider-initial">P</span><span>
                <strong>{provider.name}</strong><small>{provider.model || t("由 Codex 选择模型")}</small></span>
              {switchingProviderId === provider.id
                ? <span className="model-switch-loading">{t("切换中")}</span>
                : current ? <b className="current-pill">{t("当前")}</b> : <ChevronRight size={18} />}
            </button>;
          })}</div>}
    </div>
    <p className="model-switch-footer">
      {target === 'gui' ? t("切换后，Codex GUI 的后续请求将使用所选来源，无需重启。")
        : t("在官方模型与第三方 Provider 之间切换后，需要重启 ChatGPT/Codex 才能加载当前模型。")}</p>
  </AdaptiveSheet>;
}
