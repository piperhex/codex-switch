import { useEffect, useMemo, useState } from "react";
import type { Provider } from "../types";
import {
  findCustomTokenCostRule,
  loadCustomTokenCostRules,
  saveCustomTokenCostRules,
  type CustomTokenCostRule,
} from "../utils/tokenCost";
import {
  DEFAULT_REFERENCE_MODEL,
  findTokenCostPreset,
  TOKEN_COST_PRESETS,
  UNPRICED_PRESET_MODELS,
} from "../utils/tokenCostPresets";

type RateName = "input" | "cachedInput" | "output";
type RateSource = "custom" | "official" | "reference" | "draft";
type RateInputs = Record<RateName, number | null>;
interface PriceDraft {
  providerId: string;
  model: string;
  rates: RateInputs;
}
interface EditorOptions {
  open: boolean;
  providers: Provider[];
  referenceModel: string;
}

function firstProviderModel(provider: Provider | undefined, rules: CustomTokenCostRule[]) {
  if (!provider) return "";
  return provider.model.trim() || provider.models.find((model) => model.trim())?.trim()
    || rules.find((rule) => rule.providerId === provider.id)?.model || DEFAULT_REFERENCE_MODEL;
}

export function useCustomTokenCostEditor({ open, providers, referenceModel }: EditorOptions) {
  const [providerId, setProviderId] = useState("");
  const [model, setModel] = useState("");
  const [rules, setRules] = useState<CustomTokenCostRule[]>(loadCustomTokenCostRules);
  const [draft, setDraft] = useState<PriceDraft | null>(null);
  const selectedProvider = providers.find((provider) => provider.id === providerId);
  const modelChoices = useMemo(() => [...new Set([
    selectedProvider?.model ?? "",
    ...(selectedProvider?.models ?? []),
    ...rules.filter((rule) => rule.providerId === providerId).map((rule) => rule.model),
    ...TOKEN_COST_PRESETS.map((preset) => preset.model),
    ...UNPRICED_PRESET_MODELS,
    model,
  ].map((value) => value.trim()).filter(Boolean))], [model, providerId, rules, selectedProvider]);
  const customRule = findCustomTokenCostRule(rules, providerId, model);
  const configuredRate = selectedProvider?.kind === "custom" ? selectedProvider.modelTokenCosts?.[model] : undefined;
  const providerRates = typeof configuredRate === "number" && Number.isFinite(configuredRate) && configuredRate >= 0
    ? { input: configuredRate, cachedInput: configuredRate, output: configuredRate } : undefined;
  const officialPreset = findTokenCostPreset(model);
  const referencePreset = findTokenCostPreset(referenceModel) ?? findTokenCostPreset(DEFAULT_REFERENCE_MODEL);
  const defaultRates = customRule ?? providerRates ?? officialPreset ?? referencePreset;
  const currentDraft = draft?.providerId === providerId && draft.model === model ? draft : null;
  const rates: RateInputs = currentDraft
    ? currentDraft.rates
    : { input: defaultRates?.input ?? null, cachedInput: defaultRates?.cachedInput ?? null,
      output: defaultRates?.output ?? null };
  const valid = Boolean(providerId && model) && Object.values(rates)
    .every((rate) => rate != null && Number.isFinite(rate) && rate >= 0);
  let rateSource: RateSource = officialPreset ? "official" : "reference";
  if (customRule || providerRates) rateSource = "custom";
  if (currentDraft) rateSource = "draft";

  useEffect(() => {
    if (!open) return;
    setRules(loadCustomTokenCostRules());
    setDraft(null);
  }, [open]);

  useEffect(() => {
    if (!open || providers.some((provider) => provider.id === providerId)) return;
    setProviderId(providers[0]?.id ?? "");
    setModel(firstProviderModel(providers[0], rules));
    setDraft(null);
  }, [open, providers, providerId, rules]);

  const selectProvider = (value: string) => {
    setProviderId(value);
    setModel(firstProviderModel(providers.find((provider) => provider.id === value), rules));
    setDraft(null);
  };
  const selectModel = (value: string) => {
    setModel(value.trim());
    setDraft(null);
  };
  const setRate = (name: RateName, value: number | null) => {
    setDraft({ providerId, model, rates: { ...rates, [name]: value } });
  };
  const save = () => {
    const { input, cachedInput, output } = rates;
    if (!valid || input == null || cachedInput == null || output == null) return;
    const nextRule = { providerId, model, input, cachedInput, output };
    saveCustomTokenCostRules([
      ...rules.filter((rule) => !(rule.providerId === providerId && rule.model === model)), nextRule,
    ]);
    setRules(loadCustomTokenCostRules());
    setDraft(null);
  };
  const remove = (rule: CustomTokenCostRule) => {
    saveCustomTokenCostRules(rules.filter((current) => current !== rule));
    setRules(loadCustomTokenCostRules());
    if (rule.providerId === providerId && rule.model === model) setDraft(null);
  };

  return {
    providerId, model, rates, rules, valid, rateSource,
    providerOptions: providers.map((provider) => ({ label: provider.name, value: provider.id })),
    modelOptions: modelChoices.map((value) => ({ label: value, value })),
    selectProvider, selectModel, setRate, save, remove,
  };
}
