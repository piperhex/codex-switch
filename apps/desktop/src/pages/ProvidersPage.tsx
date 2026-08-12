import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AutoComplete, Button, Checkbox, Dropdown, Input, Popconfirm, Segmented, Select, Space, Switch, Table, Tag, Tooltip } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Bot, Check, Columns3, Pencil, Plus, RefreshCw, RotateCcw, Save, Server, Shuffle, Trash2, WalletCards, X } from "lucide-react";
import { loadProviderTokenUsage, queryProviderBalance, subscribeToProviderBalance, subscribeToTokenUsageChanges } from "../api/backend";
import type { AccountDisplayMode } from "../hooks/useAccountDisplayMode";
import type { Language, Translate } from "../i18n";
import type {
  LocalProxyStatus,
  Provider,
  ProviderApiFormat,
  ProviderBalance,
  ProviderBalancePlatform,
  ProviderInput,
  ProviderTokenUsageTotals,
} from "../types";
import { formatCompactTokenCount } from "../utils/tokenContext";

interface ProvidersPageProps {
  providers: Provider[];
  active: boolean;
  loading: boolean;
  busyProviderId: string | null;
  saving: boolean;
  localProxy: LocalProxyStatus | null;
  onSave: (provider: ProviderInput) => Promise<Provider | null>;
  onSwitch: (id: string) => void;
  onSwitchModel: (id: string, model: string) => void;
  onModelControlChange: (id: string, controlledByCodex: boolean) => void;
  onAutoSwitchChange: (id: string, enabled: boolean) => void;
  onDelete: (id: string) => void;
  onDeleteMany: (ids: string[]) => Promise<string[]>;
  displayMode: AccountDisplayMode;
  tokenUsageRefreshSeconds: number;
  language: Language;
  t: Translate;
}

const HIDDEN_COLUMNS_STORAGE_KEY = "codex-switch:provider-table-hidden-columns";
const PROVIDER_TABLE_COLUMN_KEYS = [
  "provider",
  "model",
  "api",
  "modelControl",
  "balance",
  "todayTokens",
  "totalTokens",
  "actions",
] as const;
type ProviderTableColumnKey = typeof PROVIDER_TABLE_COLUMN_KEYS[number];

function isProviderTableColumnKey(value: unknown): value is ProviderTableColumnKey {
  return typeof value === "string"
    && (PROVIDER_TABLE_COLUMN_KEYS as readonly string[]).includes(value);
}

function loadHiddenColumns(): ProviderTableColumnKey[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(HIDDEN_COLUMNS_STORAGE_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter(isProviderTableColumnKey))];
  } catch {
    return [];
  }
}

function persistHiddenColumns(columns: ProviderTableColumnKey[]) {
  window.localStorage.setItem(HIDDEN_COLUMNS_STORAGE_KEY, JSON.stringify(columns));
}

function normalizeModels(activeModel: string, values: string[]) {
  const models: string[] = [];
  const push = (value: string) => {
    const trimmed = value.trim();
    if (trimmed && !models.includes(trimmed)) models.push(trimmed);
  };
  push(activeModel);
  values.forEach(push);
  return models;
}

function modelOptions(models: string[]) {
  return models.map((model) => ({ label: model, value: model }));
}

const CONTEXT_WINDOW_OPTIONS = [128, 256, 400, 1000].map((value) => ({
  label: `${value}K`,
  value: String(value),
}));

function parseContextWindowK(value: string): number | null | undefined {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\d+$/.test(trimmed)) return undefined;
  const contextWindowK = Number(trimmed);
  const contextWindow = contextWindowK * 1000;
  return Number.isSafeInteger(contextWindow) && contextWindowK > 0 ? contextWindow : undefined;
}

function relayRoot(value: string) {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    url.pathname = url.pathname.replace(/\/v1\/?$/i, "").replace(/\/+$/, "");
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return trimmed.replace(/\/v1$/i, "");
  }
}

function relayApiUrl(value: string) {
  const root = relayRoot(value);
  return root ? `${root}/v1` : "";
}

function defaultBalanceUrl(value: string, platform: ProviderBalancePlatform) {
  const root = relayRoot(value);
  if (!root) return "";
  return platform === "newApi" ? `${root}/api/usage/token/` : `${root}/v1/usage`;
}

function defaultWalletUrl(value: string, platform: ProviderBalancePlatform) {
  const root = relayRoot(value);
  if (!root) return "";
  return platform === "newApi" ? `${root}/api/user/self` : `${root}/api/v1/user/profile`;
}

function relayName(value: string) {
  try {
    return new URL(relayRoot(value)).hostname;
  } catch {
    return "";
  }
}

function balancePlatformOptions(t: Translate, includeDisabled = true) {
  const options: { label: string; value: ProviderBalancePlatform | "none" }[] = [];
  if (includeDisabled) options.push({ label: t("providers.balance.disabled"), value: "none" });
  options.push(
    { label: "New API", value: "newApi" },
    { label: "Sub2API", value: "sub2Api" },
  );
  return options;
}

interface ProviderModalProps {
  provider: Provider | null;
  saving: boolean;
  onClose: () => void;
  onSave: (provider: ProviderInput) => Promise<Provider | null>;
  t: Translate;
}

function ProviderModal({ provider, saving, onClose, onSave, t }: ProviderModalProps) {
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [contextWindowK, setContextWindowK] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiFormat, setApiFormat] = useState<ProviderApiFormat>("openaiResponses");
  const [balancePlatform, setBalancePlatform] = useState<ProviderBalancePlatform | "none">("none");
  const [balanceQueryUrl, setBalanceQueryUrl] = useState("");
  const [balanceQueryUsesApiKey, setBalanceQueryUsesApiKey] = useState(true);
  const [balanceQueryToken, setBalanceQueryToken] = useState("");
  const [walletQueryUrl, setWalletQueryUrl] = useState("");
  const [walletQueryToken, setWalletQueryToken] = useState("");
  const [walletUsername, setWalletUsername] = useState("");
  const [walletPassword, setWalletPassword] = useState("");
  const apiFormatOptions: { label: string; value: ProviderApiFormat }[] = [
    { label: t("providers.api.responses"), value: "openaiResponses" },
    { label: t("providers.api.chatCompletions"), value: "openaiChat" },
  ];

  useEffect(() => {
    setName(provider?.name ?? "");
    setBaseUrl(provider?.baseUrl ?? "");
    const nextModels = normalizeModels(provider?.model ?? "", provider?.models ?? []);
    setModels(nextModels);
    setModel(provider?.model ?? nextModels[0] ?? "");
    setContextWindowK(provider?.contextWindow ? String(provider.contextWindow / 1000) : "");
    setApiKey("");
    setApiFormat(provider?.apiFormat ?? "openaiResponses");
    setBalancePlatform(provider?.balancePlatform ?? "none");
    setBalanceQueryUrl(provider?.balanceQueryUrl ?? "");
    setBalanceQueryUsesApiKey(provider?.balanceQueryUsesApiKey ?? true);
    setBalanceQueryToken("");
    setWalletQueryUrl(provider?.walletQueryUrl
      ?? (provider?.balancePlatform ? defaultWalletUrl(provider.baseUrl, provider.balancePlatform) : ""));
    setWalletQueryToken("");
    setWalletUsername(provider?.walletUsername ?? "");
    setWalletPassword("");
  }, [provider]);

  const normalizedModels = normalizeModels(model, models);
  const activeModel = model.trim() || (normalizedModels[0] ?? "");
  const contextWindow = parseContextWindowK(contextWindowK);
  const hasBalanceToken = balanceQueryUsesApiKey
    || Boolean(balanceQueryToken.trim() || provider?.hasBalanceQueryToken);
  const canSave = Boolean(
    name.trim()
    && baseUrl.trim()
    && activeModel
    && contextWindow !== undefined
    && (provider?.hasApiKey || apiKey.trim())
    && (balancePlatform === "none" || (balanceQueryUrl.trim() && hasBalanceToken)),
  );
  const updateModels = (values: string[]) => {
    const nextModels = normalizeModels("", values);
    setModels(nextModels);
    if (!nextModels.includes(model.trim())) setModel(nextModels[0] ?? "");
  };
  const submit = async () => {
    if (!canSave) return;
    const saved = await onSave({
      id: provider?.id,
      kind: "custom",
      name,
      baseUrl,
      model: activeModel,
      models: normalizedModels,
      contextWindow,
      modelSelectionControlledByCodex: provider?.modelSelectionControlledByCodex ?? false,
      apiKey: apiKey.trim() || undefined,
      apiFormat,
      balancePlatform: balancePlatform === "none" ? null : balancePlatform,
      balanceQueryUrl: balancePlatform === "none" ? null : balanceQueryUrl,
      balanceQueryToken: balanceQueryToken.trim() || undefined,
      balanceQueryUsesApiKey,
      walletQueryUrl: balancePlatform === "none" ? null : walletQueryUrl || null,
      walletQueryToken: walletQueryToken.trim() || undefined,
      walletUsername: walletUsername.trim() || undefined,
      walletPassword: walletPassword || undefined,
    });
    if (saved) onClose();
  };

  return (
    <div className="modal-backdrop">
      <div className="modal provider-modal">
        <button className="modal-close" disabled={saving} onClick={onClose} aria-label={t("providers.modal.close")}>
          <X size={17} />
        </button>
        <div className="modal-icon"><Server size={22} /></div>
        <h2>{provider ? t("providers.modal.editTitle") : t("providers.modal.addTitle")}</h2>
        <p>{t("providers.modal.description")}</p>
        <div className="provider-form">
          <label htmlFor="provider-name">{t("providers.form.name")}</label>
          <Input id="provider-name" value={name} disabled={saving} placeholder="OpenRouter"
            onChange={(event) => setName(event.target.value)} />
          <label htmlFor="provider-base-url">{t("providers.form.baseUrl")}</label>
          <Input id="provider-base-url" value={baseUrl} disabled={saving} placeholder="https://openrouter.ai/api/v1"
            onChange={(event) => setBaseUrl(event.target.value)} />
          <label htmlFor="provider-model">{t("providers.form.model")}</label>
          <Select id="provider-model" mode="tags" value={models} disabled={saving}
            placeholder={t("providers.form.modelsPlaceholder")} tokenSeparators={[","]}
            options={modelOptions(models)} onChange={updateModels} />
          <label htmlFor="provider-active-model">{t("providers.form.activeModel")}</label>
          <Select id="provider-active-model" value={activeModel || undefined} disabled={saving || !normalizedModels.length}
            placeholder="openai/gpt-4.1" options={modelOptions(normalizedModels)}
            onChange={(value) => setModel(value)} />
          <label htmlFor="provider-context-window">{t("providers.form.contextWindow")}</label>
          <AutoComplete id="provider-context-window" value={contextWindowK} disabled={saving}
            options={CONTEXT_WINDOW_OPTIONS} placeholder="128" allowClear
            onChange={setContextWindowK} />
          <small>{t("providers.form.contextWindowHint")}</small>
          <label htmlFor="provider-api-key">{t("providers.form.apiKey")}</label>
          <Input.Password id="provider-api-key" value={apiKey} disabled={saving}
            placeholder={provider?.hasApiKey ? t("providers.form.keepApiKey") : t("providers.form.newApiKey")}
            onChange={(event) => setApiKey(event.target.value)} />
          <label>{t("providers.form.upstreamApi")}</label>
          <Segmented value={apiFormat} options={apiFormatOptions}
            onChange={(value) => setApiFormat(value as ProviderApiFormat)} />
          <label htmlFor="provider-balance-platform">{t("providers.form.balancePlatform")}</label>
          <Select id="provider-balance-platform" value={balancePlatform} disabled={saving}
            options={balancePlatformOptions(t)}
            onChange={(value) => {
              setBalancePlatform(value);
              if (value !== "none" && !balanceQueryUrl.trim()) {
                setBalanceQueryUrl(defaultBalanceUrl(baseUrl, value));
              }
              if (value !== "none" && !walletQueryUrl.trim()) {
                setWalletQueryUrl(defaultWalletUrl(baseUrl, value));
              }
            }} />
          {balancePlatform !== "none" && <>
            <label htmlFor="provider-balance-url">{t("providers.form.balanceQueryUrl")}</label>
            <Input id="provider-balance-url" value={balanceQueryUrl} disabled={saving}
              placeholder={defaultBalanceUrl(baseUrl, balancePlatform)}
              onChange={(event) => setBalanceQueryUrl(event.target.value)} />
            <div className="provider-form-switch">
              <div>
                <label htmlFor="provider-balance-reuse-key">{t("providers.form.balanceReuseApiKey")}</label>
                <small>{t("providers.form.balanceReuseApiKeyHint")}</small>
              </div>
              <Switch id="provider-balance-reuse-key" checked={balanceQueryUsesApiKey} disabled={saving}
                onChange={setBalanceQueryUsesApiKey} />
            </div>
            {!balanceQueryUsesApiKey && <>
              <label htmlFor="provider-balance-token">{t("providers.form.balanceToken")}</label>
              <Input.Password id="provider-balance-token" value={balanceQueryToken} disabled={saving}
                placeholder={provider?.hasBalanceQueryToken
                  ? t("providers.form.keepBalanceToken")
                  : t("providers.form.newApiKey")}
                onChange={(event) => setBalanceQueryToken(event.target.value)} />
            </>}
            <label htmlFor="provider-wallet-url">{t("providers.form.walletQueryUrl")}</label>
            <Input id="provider-wallet-url" value={walletQueryUrl} disabled={saving}
              placeholder={defaultWalletUrl(baseUrl, balancePlatform)}
              onChange={(event) => setWalletQueryUrl(event.target.value)} />
            {balancePlatform === "newApi" ? <>
              <label htmlFor="provider-wallet-token">{t("providers.form.walletToken")}</label>
              <Input.Password id="provider-wallet-token" value={walletQueryToken} disabled={saving}
                placeholder={provider?.hasWalletQueryToken
                  ? t("providers.form.keepWalletToken")
                  : t("providers.form.walletTokenPlaceholder")}
                onChange={(event) => setWalletQueryToken(event.target.value)} />
              <small>{t("providers.form.walletNewApiTokenAutoIdHint")}</small>
              <div className="provider-auth-divider">{t("providers.form.walletLoginAlternative")}</div>
              <label htmlFor="provider-wallet-username">{t("providers.form.walletUsername")}</label>
              <Input id="provider-wallet-username" value={walletUsername} disabled={saving}
                placeholder={t("providers.form.walletUsernamePlaceholder")}
                onChange={(event) => setWalletUsername(event.target.value)} />
              <label htmlFor="provider-wallet-password">{t("providers.form.walletPassword")}</label>
              <Input.Password id="provider-wallet-password" value={walletPassword} disabled={saving}
                placeholder={provider?.hasWalletLoginCredentials
                  ? t("providers.form.keepWalletPassword")
                  : t("providers.form.walletPasswordPlaceholder")}
                onChange={(event) => setWalletPassword(event.target.value)} />
              <small>{t("providers.form.walletLoginHint")}</small>
            </> : <>
              <label htmlFor="provider-wallet-token">{t("providers.form.walletToken")}</label>
              <Input.Password id="provider-wallet-token" value={walletQueryToken} disabled={saving}
                placeholder={provider?.hasWalletQueryToken
                  ? t("providers.form.keepWalletToken")
                  : t("providers.form.walletTokenPlaceholder")}
                onChange={(event) => setWalletQueryToken(event.target.value)} />
              <small>{t("providers.form.walletTokenHint")}</small>
            </>}
          </>}
        </div>
        <div className="provider-modal-footer">
          <Button onClick={onClose} disabled={saving}>{t("providers.form.cancel")}</Button>
          <Button type="primary" icon={<Save size={14} />} loading={saving} disabled={!canSave}
            onClick={() => void submit()}>{t("providers.form.save")}</Button>
        </div>
      </div>
    </div>
  );
}

function OpenAiProviderModal({ provider, saving, onClose, onSave, t }: ProviderModalProps) {
  const [name, setName] = useState("Codex Switch");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");

  useEffect(() => {
    setName(provider?.name ?? "Codex Switch");
    setBaseUrl(provider?.baseUrl ?? "");
    setApiKey("");
  }, [provider]);

  const canSave = Boolean(
    name.trim()
    && baseUrl.trim(),
  );
  const submit = async () => {
    if (!canSave) return;
    const saved = await onSave({
      id: provider?.id,
      kind: "openai",
      name,
      baseUrl,
      model: provider?.model ?? "",
      models: provider?.models ?? [],
      modelSelectionControlledByCodex: true,
      apiKey: apiKey.trim() || undefined,
      apiFormat: "openaiResponses",
      balancePlatform: null,
      balanceQueryUrl: null,
      balanceQueryUsesApiKey: true,
      walletQueryUrl: null,
    });
    if (saved) onClose();
  };

  return (
    <div className="modal-backdrop">
      <div className="modal provider-modal">
        <button className="modal-close" disabled={saving} onClick={onClose}
          aria-label={t("providers.openai.close")}>
          <X size={17} />
        </button>
        <div className="modal-icon"><Bot size={22} /></div>
        <h2>{provider ? t("providers.openai.editTitle") : t("providers.openai.addTitle")}</h2>
        <p>{t("providers.openai.description")}</p>
        <div className="provider-form">
          <label htmlFor="openai-provider-name">{t("providers.form.name")}</label>
          <Input id="openai-provider-name" value={name} disabled={saving} placeholder="Codex Switch"
            onChange={(event) => setName(event.target.value)} />
          <label htmlFor="openai-provider-base-url">{t("providers.openai.baseUrl")}</label>
          <Input id="openai-provider-base-url" value={baseUrl} disabled={saving}
            placeholder="https://upstream-codex-switch.example.com/v1"
            onChange={(event) => setBaseUrl(event.target.value)} />
          <small>{t("providers.openai.baseUrlHint")}</small>
          <label htmlFor="openai-provider-api-key">{t("providers.openai.apiKeyOptional")}</label>
          <Input.Password id="openai-provider-api-key" value={apiKey} disabled={saving}
            placeholder={provider?.hasApiKey
              ? t("providers.form.keepApiKey")
              : t("providers.openai.apiKeyPlaceholder")}
            onChange={(event) => setApiKey(event.target.value)} />
        </div>
        <div className="provider-modal-footer">
          <Button onClick={onClose} disabled={saving}>{t("providers.form.cancel")}</Button>
          <Button type="primary" icon={<Save size={14} />} loading={saving} disabled={!canSave}
            onClick={() => void submit()}>{t("providers.form.save")}</Button>
        </div>
      </div>
    </div>
  );
}

function RelayStationModal({
  saving,
  onClose,
  onSave,
  t,
}: Omit<ProviderModalProps, "provider">) {
  const [platform, setPlatform] = useState<ProviderBalancePlatform | undefined>();
  const [stationUrl, setStationUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [model, setModel] = useState("gpt-5.6-sol");
  const [contextWindowK, setContextWindowK] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [balanceQueryUrl, setBalanceQueryUrl] = useState("");
  const [balanceQueryUsesApiKey, setBalanceQueryUsesApiKey] = useState(true);
  const [balanceQueryToken, setBalanceQueryToken] = useState("");
  const [walletQueryUrl, setWalletQueryUrl] = useState("");
  const [walletQueryToken, setWalletQueryToken] = useState("");
  const [walletUsername, setWalletUsername] = useState("");
  const [walletPassword, setWalletPassword] = useState("");

  const updateStation = (value: string) => {
    setStationUrl(value);
    setBaseUrl(relayApiUrl(value));
    if (!nameTouched) setName(relayName(value));
    if (platform) {
      setBalanceQueryUrl(defaultBalanceUrl(value, platform));
      setWalletQueryUrl(defaultWalletUrl(value, platform));
    }
  };
  const updatePlatform = (value: ProviderBalancePlatform) => {
    setPlatform(value);
    setBalanceQueryUrl(defaultBalanceUrl(stationUrl, value));
    setWalletQueryUrl(defaultWalletUrl(stationUrl, value));
  };
  const canSave = Boolean(
    platform
    && stationUrl.trim()
    && apiKey.trim()
    && name.trim()
    && model.trim()
    && baseUrl.trim()
    && balanceQueryUrl.trim()
    && (balanceQueryUsesApiKey || balanceQueryToken.trim())
    && parseContextWindowK(contextWindowK) !== undefined,
  );
  const submit = async () => {
    if (!canSave || !platform) return;
    const saved = await onSave({
      kind: "custom",
      name,
      baseUrl,
      model,
      models: [model],
      contextWindow: parseContextWindowK(contextWindowK),
      modelSelectionControlledByCodex: false,
      apiKey,
      apiFormat: "openaiResponses",
      balancePlatform: platform,
      balanceQueryUrl,
      balanceQueryToken: balanceQueryToken.trim() || undefined,
      balanceQueryUsesApiKey,
      walletQueryUrl: walletQueryUrl || null,
      walletQueryToken: walletQueryToken.trim() || undefined,
      walletUsername: walletUsername.trim() || undefined,
      walletPassword: walletPassword || undefined,
    });
    if (saved) onClose();
  };

  return (
    <div className="modal-backdrop">
      <div className="modal provider-modal relay-station-modal">
        <button className="modal-close" disabled={saving} onClick={onClose}
          aria-label={t("providers.relay.close")}>
          <X size={17} />
        </button>
        <div className="modal-icon"><WalletCards size={22} /></div>
        <h2>{t("providers.relay.title")}</h2>
        <p>{t("providers.relay.description")}</p>
        <div className="provider-form">
          <label htmlFor="relay-platform">{t("providers.relay.platform")}</label>
          <Select id="relay-platform" value={platform} disabled={saving}
            placeholder={t("providers.relay.platformPlaceholder")}
            options={balancePlatformOptions(t, false)}
            onChange={(value) => updatePlatform(value as ProviderBalancePlatform)} />
          <label htmlFor="relay-url">{t("providers.relay.url")}</label>
          <Input id="relay-url" value={stationUrl} disabled={saving}
            placeholder="https://ai.example.com"
            onChange={(event) => updateStation(event.target.value)} />
          <label htmlFor="relay-token">{t("providers.relay.token")}</label>
          <Input.Password id="relay-token" value={apiKey} disabled={saving}
            placeholder="sk-..."
            onChange={(event) => setApiKey(event.target.value)} />
          <label htmlFor="relay-context-window">{t("providers.form.contextWindow")}</label>
          <AutoComplete id="relay-context-window" value={contextWindowK} disabled={saving}
            options={CONTEXT_WINDOW_OPTIONS} placeholder="128" allowClear
            onChange={setContextWindowK} />
          <small>{t("providers.form.contextWindowHint")}</small>
          <details className="provider-advanced">
            <summary>{t("providers.relay.advanced")}</summary>
            <div className="provider-advanced-fields">
              <label htmlFor="relay-name">{t("providers.form.name")}</label>
              <Input id="relay-name" value={name} disabled={saving}
                placeholder={t("providers.relay.namePlaceholder")}
                onChange={(event) => {
                  setNameTouched(true);
                  setName(event.target.value);
                }} />
              <label htmlFor="relay-model">{t("providers.form.activeModel")}</label>
              <Input id="relay-model" value={model} disabled={saving}
                onChange={(event) => setModel(event.target.value)} />
              <label htmlFor="relay-base-url">{t("providers.form.baseUrl")}</label>
              <Input id="relay-base-url" value={baseUrl} disabled={saving}
                onChange={(event) => setBaseUrl(event.target.value)} />
              <label htmlFor="relay-balance-url">{t("providers.form.balanceQueryUrl")}</label>
              <Input id="relay-balance-url" value={balanceQueryUrl} disabled={saving}
                onChange={(event) => setBalanceQueryUrl(event.target.value)} />
              <div className="provider-form-switch">
                <div>
                  <label htmlFor="relay-balance-reuse-key">{t("providers.form.balanceReuseApiKey")}</label>
                  <small>{t("providers.form.balanceReuseApiKeyHint")}</small>
                </div>
                <Switch id="relay-balance-reuse-key" checked={balanceQueryUsesApiKey} disabled={saving}
                  onChange={setBalanceQueryUsesApiKey} />
              </div>
              {!balanceQueryUsesApiKey && <>
                <label htmlFor="relay-balance-token">{t("providers.form.balanceToken")}</label>
                <Input.Password id="relay-balance-token" value={balanceQueryToken} disabled={saving}
                  placeholder={t("providers.form.newApiKey")}
                  onChange={(event) => setBalanceQueryToken(event.target.value)} />
              </>}
              <label htmlFor="relay-wallet-url">{t("providers.form.walletQueryUrl")}</label>
              <Input id="relay-wallet-url" value={walletQueryUrl} disabled={saving}
                onChange={(event) => setWalletQueryUrl(event.target.value)} />
              {platform === "newApi" ? <>
                <label htmlFor="relay-wallet-token">{t("providers.form.walletToken")}</label>
                <Input.Password id="relay-wallet-token" value={walletQueryToken} disabled={saving}
                  placeholder={t("providers.form.walletTokenPlaceholder")}
                  onChange={(event) => setWalletQueryToken(event.target.value)} />
                <small>{t("providers.form.walletNewApiTokenAutoIdHint")}</small>
                <div className="provider-auth-divider">{t("providers.form.walletLoginAlternative")}</div>
                <label htmlFor="relay-wallet-username">{t("providers.form.walletUsername")}</label>
                <Input id="relay-wallet-username" value={walletUsername} disabled={saving}
                  placeholder={t("providers.form.walletUsernamePlaceholder")}
                  onChange={(event) => setWalletUsername(event.target.value)} />
                <label htmlFor="relay-wallet-password">{t("providers.form.walletPassword")}</label>
                <Input.Password id="relay-wallet-password" value={walletPassword} disabled={saving}
                  placeholder={t("providers.form.walletPasswordPlaceholder")}
                  onChange={(event) => setWalletPassword(event.target.value)} />
                <small>{t("providers.form.walletLoginHint")}</small>
              </> : <>
                <label htmlFor="relay-wallet-token">{t("providers.form.walletToken")}</label>
                <Input.Password id="relay-wallet-token" value={walletQueryToken} disabled={saving}
                  placeholder={t("providers.form.walletTokenPlaceholder")}
                  onChange={(event) => setWalletQueryToken(event.target.value)} />
                <small>{t("providers.form.walletTokenHint")}</small>
              </>}
            </div>
          </details>
        </div>
        <div className="provider-modal-footer">
          <Button onClick={onClose} disabled={saving}>{t("providers.form.cancel")}</Button>
          <Button type="primary" icon={<Save size={14} />} loading={saving} disabled={!canSave}
            onClick={() => void submit()}>{t("providers.relay.save")}</Button>
        </div>
      </div>
    </div>
  );
}

function apiFormatTag(provider: Provider, t: Translate) {
  if (provider.kind === "openai") return <Tag color="blue">{t("providers.tag.openai")}</Tag>;
  if (provider.apiFormat === "openaiResponses") return <Tag color="green">{t("providers.tag.responses")}</Tag>;
  return <Tag color="gold">{t("providers.tag.chatBridge")}</Tag>;
}

function ProviderBalanceCell({ provider, t }: { provider: Provider; t: Translate }) {
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
  const apiValue = balance?.apiUnlimited
    ? t("providers.balance.unlimited")
    : balance?.apiAmount != null
      ? `${balance.apiAmount.toFixed(2)} ${balance.apiUnit}`
      : error
        ? t("providers.balance.failed")
        : t("providers.balance.loading");
  const walletValue = balance?.walletAmount != null
    ? `${balance.walletAmount.toFixed(2)} ${balance.walletUnit}`
    : balance?.walletError
      ? t("providers.balance.failed")
      : provider.hasWalletQueryToken || provider.hasWalletLoginCredentials
        ? t("providers.balance.loading")
        : t("providers.balance.notConfigured");
  return (
    <div className="provider-balance">
      <Tooltip title={error || balance?.walletError || t("providers.balance.refresh")}>
        <Button type="text" size="small" className="provider-balance-refresh"
          loading={loading} icon={!loading ? <RefreshCw size={13} /> : undefined}
          onClick={() => void refresh()} />
      </Tooltip>
      <div className="provider-balance-values">
        <strong><span>{t("providers.balance.api")}</span>{apiValue}</strong>
        <strong><span>{t("providers.balance.wallet")}</span>{walletValue}</strong>
        {balance && <span>{t("providers.balance.justNow")}</span>}
      </div>
    </div>
  );
}

function ProviderModelCell({
  provider,
  busy,
  onSwitchModel,
  t,
}: {
  provider: Provider;
  busy: boolean;
  onSwitchModel: (id: string, model: string) => void;
  t: Translate;
}) {
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

function ProviderModelControlCell({
  provider,
  busy,
  onModelControlChange,
  t,
}: {
  provider: Provider;
  busy: boolean;
  onModelControlChange: (id: string, controlledByCodex: boolean) => void;
  t: Translate;
}) {
  const codexControlled = provider.modelSelectionControlledByCodex;
  const fixedToCodex = provider.kind === "openai";
  return (
    <div className="provider-model-owner">
      <Tooltip title={codexControlled ? t("providers.tooltip.codexModelControl") : t("providers.tooltip.appModelControl")}>
        <Switch size="small" checked={codexControlled} disabled={busy || fixedToCodex}
          onChange={(checked) => onModelControlChange(provider.id, checked)} />
      </Tooltip>
      <span>{codexControlled ? t("providers.control.codex") : t("providers.control.app")}</span>
    </div>
  );
}

function ProviderTokenCell({
  usage,
  period,
  language,
  t,
}: {
  usage?: ProviderTokenUsageTotals;
  period: "today" | "total";
  language: Language;
  t: Translate;
}) {
  const tokens = period === "today" ? usage?.todayTokens ?? 0 : usage?.totalTokens ?? 0;
  return (
    <Tooltip title={t("providers.tokenUsage.proxyHint")} styles={{ root: { maxWidth: 400 } }}>
      <strong className="provider-token-value">{formatCompactTokenCount(tokens, language)}</strong>
    </Tooltip>
  );
}

export function ProvidersPage({
  providers,
  active,
  loading,
  busyProviderId,
  saving,
  localProxy,
  onSave,
  onSwitch,
  onSwitchModel,
  onModelControlChange,
  onAutoSwitchChange,
  onDelete,
  onDeleteMany,
  displayMode,
  tokenUsageRefreshSeconds,
  language,
  t,
}: ProvidersPageProps) {
  const [editingProvider, setEditingProvider] = useState<Provider | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [showOpenAiModal, setShowOpenAiModal] = useState(false);
  const [showRelayModal, setShowRelayModal] = useState(false);
  const [selectedProviderIds, setSelectedProviderIds] = useState<string[]>([]);
  const [bulkDeleteBusy, setBulkDeleteBusy] = useState(false);
  const [hiddenColumns, setHiddenColumns] = useState<ProviderTableColumnKey[]>(loadHiddenColumns);
  const [providerTokenUsage, setProviderTokenUsage] = useState<ProviderTokenUsageTotals[]>([]);
  const [topbarHost, setTopbarHost] = useState<HTMLElement | null>(null);
  const proxyRunning = Boolean(localProxy?.running);

  useEffect(() => {
    setTopbarHost(active ? document.getElementById("provider-topbar-actions") : null);
  }, [active]);

  useEffect(() => {
    const providerIds = new Set(providers.map((provider) => provider.id));
    setSelectedProviderIds((current) => current.filter((id) => providerIds.has(id)));
  }, [providers]);

  useEffect(() => {
    let active = true;
    let refreshing = false;
    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      const today = new Date();
      const startTs = Math.floor(new Date(
        today.getFullYear(),
        today.getMonth(),
        today.getDate(),
      ).getTime() / 1_000);
      try {
        const totals = await loadProviderTokenUsage(startTs);
        if (active) setProviderTokenUsage(totals);
      } catch {
        // Keep the last successful values when token statistics are temporarily unavailable.
      } finally {
        refreshing = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), Math.max(1, tokenUsageRefreshSeconds) * 1_000);
    const unsubscribe = subscribeToTokenUsageChanges(() => void refresh());
    return () => {
      active = false;
      window.clearInterval(timer);
      unsubscribe();
    };
  }, [tokenUsageRefreshSeconds]);

  const tokenUsageIndex = useMemo(() => {
    const byId = new Map<string, ProviderTokenUsageTotals>();
    const legacyByName = new Map<string, ProviderTokenUsageTotals>();
    providerTokenUsage.forEach((usage) => {
      if (usage.providerId) byId.set(usage.providerId, usage);
      else legacyByName.set(usage.provider.trim().toLocaleLowerCase(), usage);
    });
    return { byId, legacyByName };
  }, [providerTokenUsage]);
  const usageForProvider = (provider: Provider) => {
    const current = tokenUsageIndex.byId.get(provider.id);
    const legacy = tokenUsageIndex.legacyByName.get(provider.name.trim().toLocaleLowerCase());
    if (!current) return legacy;
    if (!legacy) return current;
    return {
      ...current,
      todayTokens: current.todayTokens + legacy.todayTokens,
      totalTokens: current.totalTokens + legacy.totalTokens,
    };
  };

  const openCreate = () => {
    setEditingProvider(null);
    setShowModal(true);
  };
  const openCreateOpenAi = () => {
    setEditingProvider(null);
    setShowOpenAiModal(true);
  };
  const openEdit = (provider: Provider) => {
    setEditingProvider(provider);
    if (provider.kind === "openai") {
      setShowOpenAiModal(true);
    } else {
      setShowModal(true);
    }
  };

  const columns: ColumnsType<Provider> = [
    {
      title: t("providers.table.provider"),
      key: "provider",
      dataIndex: "name",
      width: 240,
      render: (_, provider) => (
        <div className="provider-cell">
          <div className="provider-avatar"><Server size={15} /></div>
          <div>
            <strong>{provider.name}</strong>
            <span title={provider.baseUrl}>{provider.baseUrl}</span>
          </div>
        </div>
      ),
    },
    {
      title: t("providers.table.model"),
      key: "model",
      dataIndex: "model",
      width: 260,
      render: (_, provider) => <ProviderModelCell provider={provider}
        busy={busyProviderId === provider.id} onSwitchModel={onSwitchModel} t={t} />,
    },
    {
      title: t("providers.table.api"),
      key: "api",
      width: 120,
      render: (_, provider) => apiFormatTag(provider, t),
    },
    {
      title: t("providers.table.modelControl"),
      key: "modelControl",
      width: 130,
      render: (_, provider) => <ProviderModelControlCell provider={provider}
        busy={busyProviderId === provider.id} onModelControlChange={onModelControlChange} t={t} />,
    },
    {
      title: t("providers.table.balance"),
      key: "balance",
      width: 155,
      render: (_, provider) => <ProviderBalanceCell provider={provider} t={t} />,
    },
    {
      title: t("providers.table.todayTokens"),
      key: "todayTokens",
      width: 105,
      align: "center",
      render: (_, provider) => <ProviderTokenCell
        usage={usageForProvider(provider)} period="today" language={language} t={t} />,
    },
    {
      title: t("providers.table.totalTokens"),
      key: "totalTokens",
      width: 105,
      align: "center",
      render: (_, provider) => <ProviderTokenCell
        usage={usageForProvider(provider)} period="total" language={language} t={t} />,
    },
    {
      title: t("providers.table.actions"),
      key: "actions",
      width: 285,
      align: "right",
      fixed: "right",
      render: (_, provider) => {
        const waiting = busyProviderId === provider.id;
        return (
          <Space size={4} className="table-actions">
            {provider.kind === "custom" && (
              <Tooltip title={t(provider.autoSwitchEnabled
                ? "providers.tooltip.autoSwitchEnabled"
                : "providers.tooltip.autoSwitch")}>
                <Button size="small" type={provider.autoSwitchEnabled ? "primary" : "default"}
                  loading={waiting} icon={<Shuffle size={14} />}
                  onClick={() => onAutoSwitchChange(provider.id, !provider.autoSwitchEnabled)}>
                  {t("providers.action.autoSwitch")}
                </Button>
              </Tooltip>
            )}
            <Tooltip title={provider.supportsDirectSwitch ? t("providers.tooltip.switch") : t("providers.tooltip.requiresBridge")}>
              <Button size="small" type={provider.active ? "default" : "primary"}
                disabled={provider.active || !provider.supportsDirectSwitch}
                loading={waiting} icon={provider.active ? <Check size={14} /> : <RotateCcw size={14} />}
                onClick={() => onSwitch(provider.id)}>
                {provider.active
                  ? t("providers.action.inUse")
                  : proxyRunning
                    ? t("providers.action.hotSwitch")
                    : t("providers.action.switch")}
              </Button>
            </Tooltip>
            <Tooltip title={t("providers.tooltip.edit")}>
              <Button size="small" className="table-icon-button" icon={<Pencil size={14} />}
                onClick={() => openEdit(provider)} />
            </Tooltip>
            <Popconfirm title={t("providers.delete.title")} description={t("providers.delete.description")}
              okText={t("providers.delete.ok")} cancelText={t("providers.delete.cancel")} okButtonProps={{ danger: true }}
              onConfirm={() => onDelete(provider.id)}>
              <Tooltip title={t("providers.tooltip.delete")}>
                <Button danger size="small" className="table-icon-button" loading={waiting}
                  icon={<Trash2 size={14} />} />
              </Tooltip>
            </Popconfirm>
          </Space>
        );
      },
    },
  ];

  const hiddenColumnSet = new Set(hiddenColumns);
  const visibleColumns = columns.filter((column) =>
    !isProviderTableColumnKey(column.key) || !hiddenColumnSet.has(column.key));
  const columnSettings: { key: ProviderTableColumnKey; label: string }[] = [
    { key: "provider", label: t("providers.table.provider") },
    { key: "model", label: t("providers.table.model") },
    { key: "api", label: t("providers.table.api") },
    { key: "modelControl", label: t("providers.table.modelControl") },
    { key: "balance", label: t("providers.table.balance") },
    { key: "todayTokens", label: t("providers.table.todayTokens") },
    { key: "totalTokens", label: t("providers.table.totalTokens") },
    { key: "actions", label: t("providers.table.actions") },
  ];
  const visibleConfigurableColumnCount = columnSettings
    .filter(({ key }) => !hiddenColumnSet.has(key)).length;
  const tableScrollX = 36 + visibleColumns.reduce(
    (total, column) => total + (typeof column.width === "number" ? column.width : 0),
    0,
  );
  const setColumnVisible = (key: ProviderTableColumnKey, visible: boolean) => {
    setHiddenColumns((current) => {
      if (!visible && !current.includes(key) && visibleConfigurableColumnCount <= 1) return current;
      const next = visible
        ? current.filter((column) => column !== key)
        : [...new Set([...current, key])];
      persistHiddenColumns(next);
      return next;
    });
  };

  if (loading) return <div className="loading-state"><RefreshCw className="spin" />{t("providers.loading")}</div>;

  return (
    <>
      {topbarHost && createPortal(
        <>
          <Button type="primary" icon={<Bot size={14} />} onClick={openCreateOpenAi}>
            {t("providers.action.addOpenAi")}
          </Button>
          <Button icon={<Plus size={14} />} onClick={openCreate}>
            {t("providers.action.add")}
          </Button>
          <Button icon={<WalletCards size={14} />} onClick={() => setShowRelayModal(true)}>
            {t("providers.action.addRelay")}
          </Button>
        </>,
        topbarHost,
      )}
      <div className="provider-page">

      {providers.length ? displayMode === "table" ? (
        <div className="provider-table-wrap">
          <div className="provider-table-toolbar">
            <Popconfirm
              title={t("providers.batchDelete.title", { count: selectedProviderIds.length })}
              description={t("providers.batchDelete.description")}
              okText={t("providers.delete.ok")} cancelText={t("providers.delete.cancel")}
              okButtonProps={{ danger: true }} disabled={!selectedProviderIds.length || bulkDeleteBusy}
              onConfirm={async () => {
                const ids = [...selectedProviderIds];
                setBulkDeleteBusy(true);
                try {
                  const deletedIds = await onDeleteMany(ids);
                  const deletedIdSet = new Set(deletedIds);
                  setSelectedProviderIds((current) => current.filter((id) => !deletedIdSet.has(id)));
                } finally {
                  setBulkDeleteBusy(false);
                }
              }}
            >
              <Button danger size="small" icon={<Trash2 size={14} />} loading={bulkDeleteBusy}
                disabled={!selectedProviderIds.length}>
                {t("providers.batchDelete.action", { count: selectedProviderIds.length })}
              </Button>
            </Popconfirm>
            <Dropdown trigger={["click"]} placement="bottomRight"
              dropdownRender={() => (
                <div className="provider-column-settings" onClick={(event) => event.stopPropagation()}>
                  <strong>{t("table.columnSettings")}</strong>
                  <div className="provider-column-settings-list">
                    {columnSettings.map(({ key, label }) => {
                      const checked = !hiddenColumnSet.has(key);
                      return <Checkbox key={key} checked={checked}
                        disabled={checked && visibleConfigurableColumnCount <= 1}
                        onChange={(event) => setColumnVisible(key, event.target.checked)}>
                        {label}
                      </Checkbox>;
                    })}
                  </div>
                </div>
              )}
            >
              <Tooltip title={t("table.columnSettings")}>
                <Button size="small" className="table-icon-button"
                  aria-label={t("table.columnSettings")} icon={<Columns3 size={15} />} />
              </Tooltip>
            </Dropdown>
          </div>
          <Table rowKey="id" size="small" columns={visibleColumns} dataSource={providers}
            rowSelection={{
              fixed: true,
              columnWidth: 36,
              selectedRowKeys: selectedProviderIds,
              onChange: (keys) => setSelectedProviderIds(keys.map(String)),
            }}
            rowClassName={(provider) => (provider.active ? "active-row" : "")}
            pagination={false} scroll={{ x: tableScrollX }} />
        </div>
      ) : (
        <div className="provider-card-grid">
          {providers.map((provider) => {
            const waiting = busyProviderId === provider.id;
            return <article key={provider.id} className={`provider-card${provider.active ? " active" : ""}${provider.supportsDirectSwitch ? " switchable" : ""}`}
              onClick={(event) => {
                if ((event.target as HTMLElement).closest("button, input, select, .ant-select")) return;
                if (!provider.active && provider.supportsDirectSwitch) onSwitch(provider.id);
              }}>
              <div className="card-topline" />
              <header className="provider-card-head">
                <div className="provider-avatar"><Server size={18} /></div>
                <div><strong>{provider.name}</strong><span title={provider.baseUrl}>{provider.baseUrl}</span></div>
                {provider.active
                  ? <Tag className="current-tag">{t("providers.status.current")}</Tag>
                  : provider.supportsDirectSwitch ? <Tag>{t("providers.status.ready")}</Tag>
                    : <Tag color="gold">{t("providers.status.bridgeRequired")}</Tag>}
                <div className="provider-card-top-actions">
                  {provider.kind === "custom" && (
                    <Tooltip title={t(provider.autoSwitchEnabled
                      ? "providers.tooltip.autoSwitchEnabled"
                      : "providers.tooltip.autoSwitch")}>
                      <Button size="small" type={provider.autoSwitchEnabled ? "primary" : "default"}
                        className="table-icon-button" loading={waiting}
                        aria-label={t("providers.action.autoSwitch")} icon={<Shuffle size={14} />}
                        onClick={() => onAutoSwitchChange(provider.id, !provider.autoSwitchEnabled)} />
                    </Tooltip>
                  )}
                  <Popconfirm title={t("providers.delete.title")} description={t("providers.delete.description")}
                    okText={t("providers.delete.ok")} cancelText={t("providers.delete.cancel")} okButtonProps={{ danger: true }}
                    onConfirm={() => onDelete(provider.id)}>
                    <Tooltip title={t("providers.tooltip.delete")}><Button danger size="small" className="table-icon-button"
                      loading={waiting} icon={<Trash2 size={14} />} /></Tooltip>
                  </Popconfirm>
                  <Tooltip title={t("providers.tooltip.edit")}><Button size="small" className="table-icon-button"
                    icon={<Pencil size={14} />} onClick={() => openEdit(provider)} /></Tooltip>
                </div>
              </header>
              <div className="provider-card-details">
                <div><span>{t("providers.table.model")}</span><ProviderModelCell provider={provider}
                  busy={waiting} onSwitchModel={onSwitchModel} t={t} /></div>
                <div><span>{t("providers.table.api")}</span>{apiFormatTag(provider, t)}</div>
                <div><span>{t("providers.table.modelControl")}</span><ProviderModelControlCell provider={provider}
                  busy={waiting} onModelControlChange={onModelControlChange} t={t} /></div>
                <div><span>{t("providers.table.balance")}</span><ProviderBalanceCell provider={provider} t={t} /></div>
                <div><span>{t("providers.table.todayTokens")}</span><ProviderTokenCell
                  usage={usageForProvider(provider)} period="today" language={language} t={t} /></div>
                <div><span>{t("providers.table.totalTokens")}</span><ProviderTokenCell
                  usage={usageForProvider(provider)} period="total" language={language} t={t} /></div>
              </div>
            </article>;
          })}
        </div>
      ) : (
        <div className="provider-empty">
          <Server size={24} />
          <strong>{t("providers.empty.title")}</strong>
          <Space size={8}>
            <Button type="primary" icon={<Bot size={14} />} onClick={openCreateOpenAi}>
              {t("providers.action.addOpenAi")}
            </Button>
            <Button icon={<Plus size={14} />} onClick={openCreate}>{t("providers.action.add")}</Button>
          </Space>
        </div>
      )}

      {showModal && <ProviderModal provider={editingProvider} saving={saving}
        onClose={() => setShowModal(false)} onSave={onSave} t={t} />}
      {showOpenAiModal && <OpenAiProviderModal provider={editingProvider} saving={saving}
        onClose={() => setShowOpenAiModal(false)} onSave={onSave} t={t} />}
      {showRelayModal && <RelayStationModal saving={saving}
        onClose={() => setShowRelayModal(false)} onSave={onSave} t={t} />}
      </div>
    </>
  );
}
