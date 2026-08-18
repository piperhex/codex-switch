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
  onSwitchAccount: (deviceId: string, accountId: string) => Promise<boolean>;
  onSwitchProvider: (deviceId: string, providerId: string) => Promise<boolean>;
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
  const busy = Boolean(switchingAccountId || switchingProviderId);
  const providerSupported = device?.capabilities?.includes("provider-switch") ?? false;
  const providerAvailable = providerSupported && Boolean(device?.localProxyRunning);
  const groupSupported = device?.capabilities?.includes("provider-group-switch") ?? false;
  const groups = [...new Set(providers.map((provider) => provider.group).filter(Boolean))];

  const selectAccount = async (accountId: string) => {
    if (!device || busy) return;
    if (await onSwitchAccount(device.deviceId, accountId)) onClose();
  };
  const selectProvider = async (providerId: string) => {
    if (!device || busy || !providerAvailable) return;
    if (await onSwitchProvider(device.deviceId, providerId)) onClose();
  };
  const selectProviderGroup = async (group: string) => {
    if (!device || busy || !providerAvailable || !groupSupported) return;
    if (await onSwitchProviderGroup(device.deviceId, group)) onClose();
  };

  return <AdaptiveSheet open={Boolean(device)} title="切换模型"
    subtitle={device ? `${device.name} · 选择这台 PC 使用的模型来源` : undefined}
    onClose={onClose}>
    <div className="model-switch-section">
      <h3>官方模型</h3>
      {!accounts.length ? <p className="model-switch-empty">暂无已同步的官方账号。</p>
        : <div className="select-list account-select-list">{accounts.map((account) => {
          const current = !device?.activeProviderId
            && !device?.activeProviderGroup
            && device?.activeAccountId === account.id;
          return <button type="button" disabled={busy || !device?.online || current}
            key={`account:${account.id}`} onClick={() => void selectAccount(account.id)}>
            <span className="account-initial">O</span><span><strong>{account.email}</strong>
              <small>官方模型 · {account.plan || "ChatGPT"}</small></span>
            {switchingAccountId === account.id
              ? <span className="model-switch-loading">切换中</span>
              : current ? <b className="current-pill">当前</b> : <ChevronRight size={18} />}
          </button>;
        })}</div>}
    </div>

    <div className="model-switch-section">
      <div className="model-switch-heading"><h3>第三方 Provider</h3>
        {!providerSupported ? <span>请先更新 PC 端</span>
          : !device?.localProxyRunning ? <span>请先在 PC 端启动本地代理</span> : null}</div>
      {!providers.length ? <p className="model-switch-empty">暂无已同步的第三方 Provider。</p>
        : <div className="select-list account-select-list">
          {groups.map((group) => {
            const count = providers.filter((provider) => provider.group === group).length;
            const current = device?.activeProviderGroup === group;
            return <button type="button" disabled={busy || !device?.online || !providerAvailable
              || !groupSupported || current} key={`group:${group}`}
              onClick={() => void selectProviderGroup(group)}>
              <span className="account-initial provider-initial">G</span><span>
                <strong>{group}</strong><small>同时启用 {count} 个 API</small></span>
              {switchingProviderId === `group:${group}`
                ? <span className="model-switch-loading">切换中</span>
                : current ? <b className="current-pill">当前分组</b> : <ChevronRight size={18} />}
            </button>;
          })}
          {providers.map((provider) => {
            const current = device?.activeProviderId === provider.id;
            return <button type="button"
              disabled={busy || !device?.online || !providerAvailable || current}
              key={`provider:${provider.id}`} onClick={() => void selectProvider(provider.id)}>
              <span className="account-initial provider-initial">P</span><span>
                <strong>{provider.name}</strong><small>{provider.model || "由 Codex 选择模型"}</small></span>
              {switchingProviderId === provider.id
                ? <span className="model-switch-loading">切换中</span>
                : current ? <b className="current-pill">当前</b> : <ChevronRight size={18} />}
            </button>;
          })}</div>}
    </div>
    <p className="model-switch-footer">
      在官方模型与第三方 Provider 之间切换后，需要重启 ChatGPT/Codex 才能加载当前模型。
    </p>
  </AdaptiveSheet>;
}
