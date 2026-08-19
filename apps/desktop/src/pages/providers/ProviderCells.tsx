import { useEffect, useState } from "react";
import { Button, Select, Tag, Tooltip } from "antd";
import { RefreshCw } from "lucide-react";
import { queryProviderBalance, subscribeToProviderBalance } from "../../api/backend";
import type { Language, Translate } from "../../i18n";
import type { Provider, ProviderBalance, ProviderTokenUsageTotals } from "../../types";
import { formatCompactTokenCount } from "../../utils/tokenContext";
import { modelOptions, normalizeModels } from "./providerUtils";

export function apiFormatTag(provider: Provider, t: Translate) {
  if (provider.kind === "openai") return <Tag color="blue">{t("providers.tag.openai")}</Tag>;
  return <Tag color="cyan">{t("providers.tag.autoApi")}</Tag>;
}

function apiBalanceValue(
  balance: ProviderBalance | null,
  provider: Provider,
  error: string,
  t: Translate,
) {
  if (balance?.apiUnlimited) {
    return provider.balancePlatform === "deepSeek"
      ? t("providers.balance.unavailable")
      : t("providers.balance.unlimited");
  }
  if (balance?.apiAmount != null) return `${balance.apiAmount.toFixed(2)} ${balance.apiUnit}`;
  return error ? t("providers.balance.failed") : t("providers.balance.loading");
}

function buildDeepSeekBalanceValues(balance: ProviderBalance | null, apiValue: string) {
  if (balance?.apiUnlimited || !balance?.balanceItems?.length) return [apiValue];
  return balance.balanceItems.map((item) => `${item.amount.toFixed(2)} ${item.unit}`);
}

function walletBalanceValue(balance: ProviderBalance | null, provider: Provider, t: Translate) {
  if (balance?.walletAmount != null) {
    return `${balance.walletAmount.toFixed(2)} ${balance.walletUnit}`;
  }
  if (balance?.walletError) return t("providers.balance.failed");
  if (provider.hasWalletQueryToken || provider.hasWalletLoginCredentials) {
    return t("providers.balance.loading");
  }
  return t("providers.balance.notConfigured");
}

function BalanceValues({ options }: { options: {
  apiValue: string;
  deepSeekValues: string[];
  provider: Provider;
  t: Translate;
  walletValue: string;
} }) {
  const { apiValue, deepSeekValues, provider, t, walletValue } = options;
  if (provider.balancePlatform === "deepSeek") {
    return <>{deepSeekValues.map((value, index) => (
      <strong key={`${value}-${index}`}>
        <span>{index === 0 ? t("providers.balance.balance") : ""}</span>{value}
      </strong>
    ))}</>;
  }
  return <>
    <strong><span>{t("providers.balance.api")}</span>{apiValue}</strong>
    <strong><span>{t("providers.balance.wallet")}</span>{walletValue}</strong>
  </>;
}

export function ProviderBalanceCell({ provider, t }: { provider: Provider; t: Translate }) {
  const [balance, setBalance] = useState<ProviderBalance | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const refresh = async () => {
    if (!provider.balancePlatform) return;
    setLoading(true);
    setError("");
    try {
      setBalance(await queryProviderBalance(provider.id));
    } catch (queryError) {
      setError(String(queryError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => subscribeToProviderBalance(provider.id, (result) => {
    setBalance(result);
    setError("");
    setLoading(false);
  }), [provider.id]);

  useEffect(() => {
    let active = true;
    if (!provider.balancePlatform) {
      setBalance(null);
      setError("");
      return () => { active = false; };
    }
    setLoading(true);
    setError("");
    void queryProviderBalance(provider.id)
      .then((result) => {
        if (active) setBalance(result);
      })
      .catch((queryError) => {
        if (active) setError(String(queryError));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [provider.id, provider.balancePlatform, provider.balanceQueryUrl, provider.walletQueryUrl]);

  if (!provider.balancePlatform) {
    return <span className="provider-balance-disabled">{t("providers.balance.disabled")}</span>;
  }
  const apiValue = apiBalanceValue(balance, provider, error, t);
  const deepSeekBalanceValues = provider.balancePlatform === "deepSeek"
    ? buildDeepSeekBalanceValues(balance, apiValue)
    : [];
  const walletValue = walletBalanceValue(balance, provider, t);
  return (
    <div className="provider-balance">
      <Tooltip title={error || balance?.walletError || t("providers.balance.refresh")}>
        <Button type="text" size="small" className="provider-balance-refresh"
          loading={loading} icon={!loading ? <RefreshCw size={13} /> : undefined}
          onClick={() => void refresh()} />
      </Tooltip>
      <div className="provider-balance-values">
        <BalanceValues options={{ apiValue, deepSeekValues: deepSeekBalanceValues,
          provider, t, walletValue }} />
        {balance && <span>{t("providers.balance.justNow")}</span>}
      </div>
    </div>
  );
}

interface ModelCellProps {
  provider: Provider;
  busy: boolean;
  onSwitchModel: (id: string, model: string) => void;
  t: Translate;
}

export function ProviderModelCell({ provider, busy, onSwitchModel, t }: ModelCellProps) {
  const models = normalizeModels(provider.model, provider.models);
  if (models.length <= 1 || provider.modelSelectionControlledByCodex) {
    return <code className="provider-model-code">{provider.model}</code>;
  }
  return (
    <div className="provider-model-select">
      <Tooltip title={t("providers.tooltip.switchModel")}>
        <Select size="small" value={provider.model} disabled={busy}
          options={modelOptions(models)} popupMatchSelectWidth={false}
          onChange={(value) => onSwitchModel(provider.id, value)} />
      </Tooltip>
      <Tag>{t("providers.model.count", { count: models.length })}</Tag>
    </div>
  );
}

interface ModelControlCellProps {
  provider: Provider;
  busy: boolean;
  onModelControlChange: (id: string, controlledByCodex: boolean) => void;
  t: Translate;
}

export function ProviderModelControlCell({
  provider,
  busy,
  onModelControlChange,
  t,
}: ModelControlCellProps) {
  const codexControlled = provider.modelSelectionControlledByCodex;
  const fixedToCodex = provider.kind === "openai";
  const options = fixedToCodex
    ? [{ value: true, label: t("providers.control.byCodex") }]
    : [
        { value: true, label: t("providers.control.byCodex") },
        { value: false, label: t("providers.control.byApp") },
      ];
  return (
    <div className="provider-model-owner">
      <Tooltip title={codexControlled
        ? t("providers.tooltip.codexModelControl")
        : t("providers.tooltip.appModelControl")}>
        <Select size="small" value={codexControlled} disabled={busy || fixedToCodex}
          options={options} popupMatchSelectWidth={false}
          onChange={(value) => onModelControlChange(provider.id, value)} />
      </Tooltip>
    </div>
  );
}

interface TokenCellProps {
  usage?: ProviderTokenUsageTotals;
  period: "today" | "total";
  language: Language;
  t: Translate;
}

export function ProviderTokenCell({ usage, period, language, t }: TokenCellProps) {
  const tokens = period === "today" ? usage?.todayTokens ?? 0 : usage?.totalTokens ?? 0;
  return (
    <Tooltip title={t("providers.tokenUsage.proxyHint")} styles={{ root: { maxWidth: 400 } }}>
      <strong className="provider-token-value">{formatCompactTokenCount(tokens, language)}</strong>
    </Tooltip>
  );
}
