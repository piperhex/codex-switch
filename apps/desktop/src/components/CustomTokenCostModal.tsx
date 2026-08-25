import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Button, InputNumber, Select, Space } from "antd";
import { DollarSign, Trash2, X } from "lucide-react";
import type { Provider } from "../types";
import type { Translate } from "../i18n";
import {
  loadCustomTokenCostRules,
  saveCustomTokenCostRules,
  type CustomTokenCostRule,
} from "../utils/tokenCost";

interface CustomTokenCostModalProps {
  open: boolean;
  providers: Provider[];
  t: Translate;
  onClose: () => void;
}

function modelsForProvider(provider: Provider | undefined) {
  if (!provider) return [];
  return [...new Set([provider.model, ...provider.models].map((model) => model.trim()).filter(Boolean))];
}

function ruleFor(rules: CustomTokenCostRule[], providerId: string, model: string) {
  return rules.find((rule) => rule.providerId === providerId && rule.model === model);
}

export function CustomTokenCostModal({ open, providers, t, onClose }: CustomTokenCostModalProps) {
  const [providerId, setProviderId] = useState("");
  const [model, setModel] = useState("");
  const [input, setInput] = useState<number | null>(null);
  const [cachedInput, setCachedInput] = useState<number | null>(null);
  const [output, setOutput] = useState<number | null>(null);
  const [rules, setRules] = useState<CustomTokenCostRule[]>(loadCustomTokenCostRules);

  const selectedProvider = providers.find((provider) => provider.id === providerId);
  const models = useMemo(() => modelsForProvider(selectedProvider), [selectedProvider]);
  const modelChoices = useMemo(() => [...new Set([
    ...models,
    ...rules.filter((rule) => rule.providerId === providerId).map((rule) => rule.model),
    ...(model ? [model] : []),
  ])], [model, models, providerId, rules]);
  const providerOptions = providers.map((provider) => ({
    label: provider.name,
    value: provider.id,
    title: provider.baseUrl,
  }));
  const modelOptions = modelChoices.map((value) => ({ label: value, value }));
  const valid = input != null && cachedInput != null && output != null
    && [input, cachedInput, output].every((rate) => Number.isFinite(rate) && rate >= 0);

  useEffect(() => {
    if (!open) return;
    const nextProviderId = providers.some((provider) => provider.id === providerId)
      ? providerId
      : providers[0]?.id ?? "";
    if (nextProviderId !== providerId) setProviderId(nextProviderId);
    setRules(loadCustomTokenCostRules());
  }, [open, providers, providerId]);

  useEffect(() => {
    if (!open) return;
    const nextModel = modelChoices.includes(model) ? model : modelChoices[0] ?? "";
    if (nextModel !== model) setModel(nextModel);
  }, [open, modelChoices, model]);

  useEffect(() => {
    if (!open) return;
    const rule = ruleFor(rules, providerId, model);
    setInput(rule?.input ?? null);
    setCachedInput(rule?.cachedInput ?? null);
    setOutput(rule?.output ?? null);
  }, [open, providerId, model, rules]);

  if (!open) return null;

  const save = () => {
    if (!valid || input == null || cachedInput == null || output == null || !providerId || !model) return;
    const nextRule: CustomTokenCostRule = { providerId, model, input, cachedInput, output };
    const nextRules = [...rules.filter((rule) => !(rule.providerId === providerId && rule.model === model)), nextRule];
    saveCustomTokenCostRules(nextRules);
    setRules(nextRules);
  };

  const remove = (rule: CustomTokenCostRule) => {
    const nextRules = rules.filter((current) => current !== rule);
    saveCustomTokenCostRules(nextRules);
    setRules(nextRules);
  };

  return createPortal(
    <div className="modal-backdrop custom-token-cost-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="modal custom-token-cost-modal" role="dialog" aria-modal="true"
        aria-labelledby="custom-token-cost-title">
        <button className="modal-close" onClick={onClose} aria-label={t("tokenCost.customBilling.close")}>
          <X size={17} />
        </button>
        <div className="custom-token-cost-header">
          <div className="modal-icon"><DollarSign size={22} /></div>
          <div>
            <h2 id="custom-token-cost-title">{t("tokenCost.customBilling.title")}</h2>
            <p>{t("tokenCost.customBilling.description")}</p>
          </div>
        </div>
        <div className="custom-token-cost-editor">
          <div className="custom-token-cost-field">
            <label>{t("tokenCost.customBilling.api")}</label>
            <Select showSearch optionFilterProp="label" value={providerId || undefined}
              placeholder={t("tokenCost.customBilling.apiPlaceholder")} options={providerOptions}
              onChange={(value) => {
                setProviderId(value);
                setModel("");
              }} />
          </div>
          <div className="custom-token-cost-field">
            <label>{t("tokenCost.customBilling.model")}</label>
            <Select mode="tags" maxCount={1} showSearch optionFilterProp="label" value={model ? [model] : []}
              placeholder={modelChoices.length ? t("tokenCost.customBilling.modelPlaceholder")
                : t("tokenCost.customBilling.noModels")}
              options={modelOptions} disabled={!providerId} onChange={(values) => setModel(values[0] ?? "")} />
          </div>
          <div className="custom-token-cost-rates">
            <div className="custom-token-cost-field">
              <label>{t("tokenCost.customBilling.input")}</label>
              <InputNumber min={0} precision={6} value={input} onChange={setInput} />
            </div>
            <div className="custom-token-cost-field">
              <label>{t("tokenCost.customBilling.cachedInput")}</label>
              <InputNumber min={0} precision={6} value={cachedInput} onChange={setCachedInput} />
            </div>
            <div className="custom-token-cost-field">
              <label>{t("tokenCost.customBilling.output")}</label>
              <InputNumber min={0} precision={6} value={output} onChange={setOutput} />
            </div>
          </div>
          <small className="custom-token-cost-hint">{t("tokenCost.customBilling.perMillionHint")}</small>
          {!providers.length && (
            <small className="custom-token-cost-empty">{t("tokenCost.customBilling.noApis")}</small>
          )}
        </div>
        <div className="custom-token-cost-saved">
          <strong>{t("tokenCost.customBilling.savedTitle")}</strong>
          {rules.length ? rules.map((rule) => {
            const provider = providers.find((item) => item.id === rule.providerId);
            return <div className="custom-token-cost-saved-row" key={`${rule.providerId}:${rule.model}`}>
              <span><b>{provider?.name ?? rule.providerId}</b><code>{rule.model}</code></span>
              <small>{rule.input} / {rule.cachedInput} / {rule.output}</small>
              <Button type="text" danger size="small" aria-label={t("tokenCost.customBilling.remove")}
                icon={<Trash2 size={14} />} onClick={() => remove(rule)} />
            </div>;
          }) : <small>{t("tokenCost.customBilling.empty")}</small>}
        </div>
        <div className="custom-token-cost-footer">
          <Space>
            <Button onClick={onClose}>{t("tokenCost.settings.cancel")}</Button>
            <Button type="primary" disabled={!valid || !providerId || !model} onClick={save}>
              {t("tokenCost.customBilling.save")}
            </Button>
          </Space>
        </div>
      </section>
    </div>,
    document.body,
  );
}
