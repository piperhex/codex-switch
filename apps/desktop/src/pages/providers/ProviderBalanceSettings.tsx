import { Input, Switch } from "antd";
import type { Translate } from "../../i18n";
import type { Provider, ProviderBalancePlatform } from "../../types";
import { defaultBalanceUrl, defaultWalletUrl } from "./providerUtils";

type DetectionState = "idle" | "detecting" | "detected" | "notFound";

export interface ProviderBalanceSettingsProps {
  baseUrl: string;
  balancePlatform: ProviderBalancePlatform | null;
  balanceQueryUrl: string;
  balanceQueryUsesApiKey: boolean;
  balanceQueryToken: string;
  detectionState: DetectionState;
  provider: Provider | null;
  saving: boolean;
  walletQueryUrl: string;
  walletQueryToken: string;
  walletUsername: string;
  walletPassword: string;
  onBalanceQueryUrlChange: (value: string) => void;
  onBalanceQueryUsesApiKeyChange: (value: boolean) => void;
  onBalanceQueryTokenChange: (value: string) => void;
  onWalletQueryUrlChange: (value: string) => void;
  onWalletQueryTokenChange: (value: string) => void;
  onWalletUsernameChange: (value: string) => void;
  onWalletPasswordChange: (value: string) => void;
  t: Translate;
}

const PLATFORM_LABELS: Record<ProviderBalancePlatform, string> = {
  newApi: "New API",
  sub2Api: "Sub2API",
  deepSeek: "DeepSeek",
};

export function ProviderBalanceSettings({
  baseUrl,
  balancePlatform,
  balanceQueryUrl,
  balanceQueryUsesApiKey,
  balanceQueryToken,
  detectionState,
  provider,
  saving,
  walletQueryUrl,
  walletQueryToken,
  walletUsername,
  walletPassword,
  onBalanceQueryUrlChange,
  onBalanceQueryUsesApiKeyChange,
  onBalanceQueryTokenChange,
  onWalletQueryUrlChange,
  onWalletQueryTokenChange,
  onWalletUsernameChange,
  onWalletPasswordChange,
  t,
}: ProviderBalanceSettingsProps) {
  const detectionCopy = detectionState === "idle"
    ? t("providers.form.platformAwaitingConnection")
    : detectionState === "detecting"
      ? t("providers.form.platformDetecting")
      : balancePlatform
        ? t("providers.form.platformDetected", { platform: PLATFORM_LABELS[balancePlatform] })
        : t("providers.form.platformNotDetected");

  return (
    <details className="provider-advanced">
      <summary>{t("providers.form.balancePlatform")}</summary>
      <div className="provider-advanced-fields">
        <small className={detectionState === "notFound" ? "provider-form-error" : undefined}>
          {detectionCopy}
        </small>
        {balancePlatform && <>
          <label htmlFor="provider-balance-url">{t("providers.form.balanceQueryUrl")}</label>
          <Input id="provider-balance-url" value={balanceQueryUrl} disabled={saving}
            placeholder={defaultBalanceUrl(baseUrl, balancePlatform)}
            onChange={(event) => onBalanceQueryUrlChange(event.target.value)} />
          <div className="provider-form-switch">
            <div>
              <label htmlFor="provider-balance-reuse-key">{t("providers.form.balanceReuseApiKey")}</label>
              <small>{t("providers.form.balanceReuseApiKeyHint")}</small>
            </div>
            <Switch id="provider-balance-reuse-key" checked={balanceQueryUsesApiKey} disabled={saving}
              onChange={onBalanceQueryUsesApiKeyChange} />
          </div>
          {!balanceQueryUsesApiKey && <>
            <label htmlFor="provider-balance-token">{t("providers.form.balanceToken")}</label>
            <Input.Password id="provider-balance-token" value={balanceQueryToken} disabled={saving}
              placeholder={provider?.hasBalanceQueryToken
                ? t("providers.form.keepBalanceToken") : t("providers.form.newApiKey")}
              onChange={(event) => onBalanceQueryTokenChange(event.target.value)} />
          </>}
          <label htmlFor="provider-wallet-url">{t("providers.form.walletQueryUrl")}</label>
          <Input id="provider-wallet-url" value={walletQueryUrl} disabled={saving}
            placeholder={defaultWalletUrl(baseUrl, balancePlatform)}
            onChange={(event) => onWalletQueryUrlChange(event.target.value)} />
          {balancePlatform === "newApi" ? (
            <NewApiWalletFields
              provider={provider}
              saving={saving}
              walletQueryToken={walletQueryToken}
              walletUsername={walletUsername}
              walletPassword={walletPassword}
              onWalletQueryTokenChange={onWalletQueryTokenChange}
              onWalletUsernameChange={onWalletUsernameChange}
              onWalletPasswordChange={onWalletPasswordChange}
              t={t}
            />
          ) : (
            <TokenWalletFields provider={provider} saving={saving} walletQueryToken={walletQueryToken}
              onWalletQueryTokenChange={onWalletQueryTokenChange} t={t} />
          )}
        </>}
      </div>
    </details>
  );
}

interface WalletFieldProps {
  provider: Provider | null;
  saving: boolean;
  walletQueryToken: string;
  onWalletQueryTokenChange: (value: string) => void;
  t: Translate;
}

function TokenWalletFields({
  provider,
  saving,
  walletQueryToken,
  onWalletQueryTokenChange,
  t,
}: WalletFieldProps) {
  return <>
    <label htmlFor="provider-wallet-token">{t("providers.form.walletToken")}</label>
    <Input.Password id="provider-wallet-token" value={walletQueryToken} disabled={saving}
      placeholder={provider?.hasWalletQueryToken
        ? t("providers.form.keepWalletToken") : t("providers.form.walletTokenPlaceholder")}
      onChange={(event) => onWalletQueryTokenChange(event.target.value)} />
    <small>{t("providers.form.walletTokenHint")}</small>
  </>;
}

interface NewApiWalletFieldProps extends WalletFieldProps {
  walletUsername: string;
  walletPassword: string;
  onWalletUsernameChange: (value: string) => void;
  onWalletPasswordChange: (value: string) => void;
}

function NewApiWalletFields({
  provider,
  saving,
  walletQueryToken,
  walletUsername,
  walletPassword,
  onWalletQueryTokenChange,
  onWalletUsernameChange,
  onWalletPasswordChange,
  t,
}: NewApiWalletFieldProps) {
  return <>
    <label htmlFor="provider-wallet-token">{t("providers.form.walletToken")}</label>
    <Input.Password id="provider-wallet-token" value={walletQueryToken} disabled={saving}
      placeholder={provider?.hasWalletQueryToken
        ? t("providers.form.keepWalletToken") : t("providers.form.walletTokenPlaceholder")}
      onChange={(event) => onWalletQueryTokenChange(event.target.value)} />
    <small>{t("providers.form.walletNewApiTokenAutoIdHint")}</small>
    <div className="provider-auth-divider">{t("providers.form.walletLoginAlternative")}</div>
    <label htmlFor="provider-wallet-username">{t("providers.form.walletUsername")}</label>
    <Input id="provider-wallet-username" value={walletUsername} disabled={saving}
      placeholder={t("providers.form.walletUsernamePlaceholder")}
      onChange={(event) => onWalletUsernameChange(event.target.value)} />
    <label htmlFor="provider-wallet-password">{t("providers.form.walletPassword")}</label>
    <Input.Password id="provider-wallet-password" value={walletPassword} disabled={saving}
      placeholder={provider?.hasWalletLoginCredentials
        ? t("providers.form.keepWalletPassword") : t("providers.form.walletPasswordPlaceholder")}
      onChange={(event) => onWalletPasswordChange(event.target.value)} />
    <small>{t("providers.form.walletLoginHint")}</small>
  </>;
}
