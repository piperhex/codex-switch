import type { Provider, ProviderTokenUsageTotals } from "../types";

interface TokenUsageIndex {
  byId: Map<string, ProviderTokenUsageTotals>;
  legacyByName: Map<string, ProviderTokenUsageTotals>;
}

function buildTokenUsageIndex(providerTokenUsage: ProviderTokenUsageTotals[]): TokenUsageIndex {
  const byId = new Map<string, ProviderTokenUsageTotals>();
  const legacyByName = new Map<string, ProviderTokenUsageTotals>();
  providerTokenUsage.forEach((usage) => {
    if (usage.providerId) byId.set(usage.providerId, usage);
    else legacyByName.set(usage.provider.trim().toLocaleLowerCase(), usage);
  });
  return { byId, legacyByName };
}

function findIndexedProviderTokenUsage(provider: Provider, index: TokenUsageIndex) {
  const current = index.byId.get(provider.id);
  const legacy = index.legacyByName.get(provider.name.trim().toLocaleLowerCase());
  if (!current) return legacy;
  if (!legacy) return current;
  return {
    ...current,
    todayTokens: current.todayTokens + legacy.todayTokens,
    totalTokens: current.totalTokens + legacy.totalTokens,
  };
}

export function createProviderTokenUsageLookup(providerTokenUsage: ProviderTokenUsageTotals[]) {
  const index = buildTokenUsageIndex(providerTokenUsage);
  return (provider: Provider) => findIndexedProviderTokenUsage(provider, index);
}

export function findProviderTokenUsage(
  provider: Provider,
  providerTokenUsage: ProviderTokenUsageTotals[],
) {
  return findIndexedProviderTokenUsage(provider, buildTokenUsageIndex(providerTokenUsage));
}
