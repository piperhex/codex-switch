import { useEffect, useState } from "react";
import { Button, Input, Select } from "antd";
import { Boxes, RefreshCw, Save, X } from "lucide-react";

import { PROVIDER_CATALOG, type ProviderPresetId } from "../../utils/providerCatalog";
import {
  catalogContextWindows,
  catalogImageInputModels,
  catalogReasoningEfforts,
} from "../../utils/providerCatalogCapabilities";
import { modelOptions, normalizeModels } from "./providerUtils";
import type { ProviderModalProps } from "./ProviderModal";
import { usePresetModelLoader } from "./usePresetModelLoader";

interface CatalogProviderModalProps extends ProviderModalProps {
  presetId: ProviderPresetId;
}

function normalizedUrl(value: string) {
  return value.trim().replace(/\/+$/, "");
}

export function CatalogProviderModal({
  presetId,
  provider,
  saving,
  onClose,
  onSave,
  t,
}: CatalogProviderModalProps) {
  const preset = PROVIDER_CATALOG[presetId];
  const [endpointId, setEndpointId] = useState<string>(preset.endpoints[0].id);
  const [baseUrl, setBaseUrl] = useState<string>(preset.defaultBaseUrl);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const endpoint = preset.endpoints.find((candidate) => candidate.id === endpointId)
    ?? preset.endpoints[0];

  useEffect(() => {
    const initialEndpoint = preset.endpoints.find((candidate) => (
      provider
      && normalizedUrl(candidate.baseUrl) === normalizedUrl(provider.baseUrl)
      && candidate.apiFormat === provider.apiFormat
    )) ?? preset.endpoints[0];
    const initialModels = normalizeModels(
      provider?.model ?? "",
      provider?.models?.length ? provider.models : [...initialEndpoint.fallbackModels],
    );
    setEndpointId(initialEndpoint.id);
    setBaseUrl(provider?.baseUrl ?? initialEndpoint.baseUrl);
    setApiKey("");
    setModels(initialModels);
    setModel(provider?.model ?? initialModels[0] ?? "");
  }, [preset, provider]);

  const savedCredentialAvailable = Boolean(
    provider?.hasApiKey
    && normalizedUrl(provider.baseUrl) === normalizedUrl(baseUrl)
    && provider.apiFormat === endpoint.apiFormat,
  );
  const handleLoadedModels = (latest: string[]) => {
    setModels(latest);
    setModel((current) => latest.includes(current) ? current : latest[0] ?? "");
  };
  const loader = usePresetModelLoader({
    presetId,
    baseUrl,
    apiKey,
    providerId: provider?.id,
    savedCredentialAvailable,
    apiKeyRequired: preset.apiKeyRequired,
    modelsAvailable: preset.modelsAvailable,
    fallbackModels: [...endpoint.fallbackModels],
    onModels: handleLoadedModels,
    t,
  });

  const selectEndpoint = (nextEndpointId: string) => {
    const nextEndpoint = preset.endpoints.find((candidate) => candidate.id === nextEndpointId);
    if (!nextEndpoint) return;
    const nextModels = [...nextEndpoint.fallbackModels];
    setEndpointId(nextEndpoint.id);
    setBaseUrl(nextEndpoint.baseUrl);
    setApiKey("");
    setModels(nextModels);
    setModel(nextModels[0] ?? "");
  };

  const normalizedModels = normalizeModels(model, models);
  const activeModel = model.trim() || normalizedModels[0] || "";
  const identityIsValid = preset.isIdentity({
    kind: "custom",
    name: preset.displayName,
    baseUrl,
    apiFormat: endpoint.apiFormat,
  });
  const canSave = Boolean(
    identityIsValid
    && activeModel
    && normalizedModels.length
    && loader.credentialAvailable,
  );
  const submit = async () => {
    if (!canSave) return;
    const saved = await onSave({
      id: provider?.id,
      kind: "custom",
      name: preset.displayName,
      baseUrl,
      model: activeModel,
      models: normalizedModels,
      modelReasoningEfforts: catalogReasoningEfforts(
        presetId,
        normalizedModels,
        provider?.modelReasoningEfforts ?? {},
      ),
      modelContextWindows: catalogContextWindows(
        presetId,
        normalizedModels,
        provider?.modelContextWindows ?? {},
      ),
      imageInputModels: catalogImageInputModels(
        presetId,
        normalizedModels,
        provider?.imageInputModels ?? [],
      ),
      contextWindow: null,
      modelSelectionControlledByCodex: true,
      apiKey: apiKey.trim() || undefined,
      apiFormat: endpoint.apiFormat,
      balancePlatform: null,
      balanceQueryUrl: null,
      balanceQueryUsesApiKey: true,
      walletQueryUrl: null,
    });
    if (saved) onClose();
  };

  let modelsStatus = t(preset.modelsAvailable
    ? "providers.catalog.modelsAutoHint"
    : "providers.catalog.modelsStaticHint");
  if (loader.loadedCount !== null) {
    modelsStatus = t("providers.catalog.modelsUpdated", { count: loader.loadedCount });
  }
  if (loader.error) modelsStatus = loader.error;

  return (
    <div className="modal-backdrop provider-modal-backdrop">
      <div className="modal provider-modal catalog-provider-modal">
        <button className="modal-close" disabled={saving} onClick={onClose}
          aria-label={t("providers.catalog.close", { provider: preset.displayName })}>
          <X size={17} />
        </button>
        <div className="modal-icon"><Boxes size={22} /></div>
        <h2>{t(provider ? "providers.catalog.editTitle" : "providers.catalog.addTitle", {
          provider: preset.displayName,
        })}</h2>
        <p>{t(preset.descriptionKey)}</p>
        <div className="provider-form">
          {preset.endpoints.length > 1 && <>
            <label htmlFor="catalog-endpoint">{t("providers.catalog.endpoint")}</label>
            <Select id="catalog-endpoint" value={endpointId} disabled={saving}
              options={preset.endpoints.map((item) => ({
                label: t(item.labelKey),
                value: item.id,
              }))}
              onChange={selectEndpoint} />
          </>}
          <label htmlFor="catalog-base-url">{t("providers.form.baseUrl")}</label>
          <Input id="catalog-base-url" value={baseUrl} disabled={saving || !preset.baseUrlEditable}
            onChange={(event) => setBaseUrl(event.target.value)} />
          <label htmlFor="catalog-api-key">{t(preset.apiKeyRequired
            ? "providers.form.apiKey"
            : "providers.catalog.apiKeyOptional")}</label>
          <Input.Password id="catalog-api-key" value={apiKey} disabled={saving}
            placeholder={savedCredentialAvailable
              ? t("providers.form.keepApiKey")
              : t("providers.form.newApiKey")}
            onChange={(event) => setApiKey(event.target.value)} />
          <div className="provider-form-label-row">
            <label htmlFor="catalog-models">{t("providers.catalog.models")}</label>
            {preset.modelsAvailable && <Button size="small" icon={<RefreshCw size={13} />}
              loading={loader.loading} disabled={saving || !loader.credentialAvailable}
              onClick={() => void loader.loadModels()}>
              {t("providers.catalog.fetchModels")}
            </Button>}
          </div>
          <Select id="catalog-models" mode="tags" value={models}
            disabled={saving || loader.loading} options={modelOptions(models)} tokenSeparators={[","]}
            onChange={(values) => {
              const nextModels = normalizeModels("", values);
              setModels(nextModels);
              if (!nextModels.includes(model)) setModel(nextModels[0] ?? "");
            }} />
          <small className={loader.error ? "provider-form-error" : undefined}>{modelsStatus}</small>
          <label htmlFor="catalog-active-model">{t("providers.form.activeModel")}</label>
          <Select id="catalog-active-model" value={activeModel || undefined}
            disabled={saving || !normalizedModels.length} options={modelOptions(normalizedModels)}
            onChange={setModel} />
          <div className="provider-integration-note"><span>{t(preset.noteKey)}</span></div>
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
