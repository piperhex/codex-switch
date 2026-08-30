import { Cascader, Tooltip } from "antd";
import type { Translate } from "../i18n";
import type { Account, ImageModelTarget, ImageRouteKind, Provider } from "../types";

interface ImageModelRouteSelectProps {
  accounts: Account[];
  providers: Provider[];
  routeKind: ImageRouteKind;
  target: ImageModelTarget | null | undefined;
  busy: boolean;
  onChange: (routeKind: ImageRouteKind, target: ImageModelTarget | null) => void;
  privacyMode?: boolean;
  t: Translate;
}

interface RouteOption {
  value: string;
  label: string;
  children?: RouteOption[];
}

const OFFICIAL_PREFIX = "official:";
const PROVIDER_PREFIX = "provider:";

function accountLabel(account: Account, privacyMode: boolean) {
  if (!privacyMode) return account.email;
  if (account.email.length <= 10) return "*****";
  return `${account.email.slice(0, 5)}*****${account.email.slice(-5)}`;
}

function providerModels(provider: Provider, routeKind: ImageRouteKind) {
  const models = [...new Set([provider.model, ...provider.models].filter(Boolean))];
  if (routeKind === "output") return models;
  const supportedModels = new Set(provider.imageInputModels);
  return models.filter((model) => supportedModels.has(model));
}

function buildOptions(options: {
  accounts: Account[];
  providers: Provider[];
  routeKind: ImageRouteKind;
  privacyMode: boolean;
}): RouteOption[] {
  const officialAccounts = options.accounts
    .filter((account) => options.routeKind === "input" || !account.agentIdentity)
    .map((account) => ({
      value: `${OFFICIAL_PREFIX}${account.id}`,
      label: accountLabel(account, options.privacyMode),
    }));
  const providerOptions = options.providers.flatMap((provider) => {
    const models = providerModels(provider, options.routeKind);
    if (!models.length) return [];
    return [{
      value: `${PROVIDER_PREFIX}${provider.id}`,
      label: provider.name,
      children: models.map((model) => ({ value: model, label: model })),
    }];
  });
  return [...officialAccounts, ...providerOptions];
}

function targetPath(target: ImageModelTarget | null | undefined): string[] | undefined {
  if (!target) return undefined;
  if (target.kind === "official") return [`${OFFICIAL_PREFIX}${target.accountId}`];
  return [`${PROVIDER_PREFIX}${target.providerId}`, target.model];
}

function parseTarget(path: readonly unknown[] | null | undefined): ImageModelTarget | null {
  if (!Array.isArray(path)) return null;
  const [source, model] = path.map(String);
  if (source?.startsWith(OFFICIAL_PREFIX)) {
    return { kind: "official", accountId: source.slice(OFFICIAL_PREFIX.length) };
  }
  if (source?.startsWith(PROVIDER_PREFIX) && model) {
    return { kind: "provider", providerId: source.slice(PROVIDER_PREFIX.length), model };
  }
  return null;
}

export function ImageModelRouteSelect({
  accounts,
  providers,
  routeKind,
  target,
  busy,
  onChange,
  privacyMode = false,
  t,
}: ImageModelRouteSelectProps) {
  const options = buildOptions({ accounts, providers, routeKind, privacyMode });
  const labelKey = routeKind === "input"
    ? "providers.proxy.imageInputModel"
    : "providers.proxy.imageOutputModel";
  const tooltipKey = routeKind === "input"
    ? "providers.proxy.imageInputModelTooltip"
    : "providers.proxy.imageOutputModelTooltip";

  return (
    <label className="proxy-image-model-field">
      <span>{t(labelKey)}</span>
      <Tooltip title={t(tooltipKey)} styles={{ root: { maxWidth: 400 } }}>
        <Cascader
          className="proxy-image-model-select"
          size="small"
          aria-label={t(labelKey)}
          value={targetPath(target)}
          options={options}
          placeholder={t("providers.proxy.imageModelPlaceholder")}
          popupClassName="proxy-image-model-dropdown"
          disabled={busy || options.length === 0}
          allowClear
          showSearch
          displayRender={(labels) => labels.join(" / ")}
          onChange={(path) => onChange(routeKind, parseTarget(path))}
        />
      </Tooltip>
    </label>
  );
}
