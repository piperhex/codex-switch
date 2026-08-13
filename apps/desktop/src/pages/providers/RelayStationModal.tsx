import { useState } from "react";
import { AutoComplete, Button, Input, Select, Switch } from "antd";
import { Save, WalletCards, X } from "lucide-react";
import type { ProviderBalancePlatform } from "../../types";
import {
  balancePlatformOptions,
  CONTEXT_WINDOW_OPTIONS,
  defaultBalanceUrl,
  defaultWalletUrl,
  parseContextWindowK,
  relayApiUrl,
  relayName,
} from "./providerUtils";
import { RelayModelPicker } from "./RelayModelPicker";
import type { ProviderModalProps } from "./ProviderModal";
export function RelayStationModal({
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
  const [models, setModels] = useState(["gpt-5.6-sol"]);
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
      models,
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
          <RelayModelPicker baseUrl={baseUrl} apiKey={apiKey} enabled={Boolean(platform)}
            disabled={saving} models={models} activeModel={model}
            onModelsChange={setModels} onActiveModelChange={setModel} t={t} />
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
