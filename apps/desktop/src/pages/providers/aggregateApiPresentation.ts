import type { Translate } from "../../i18n";
import type { AggregateApi, Provider } from "../../types";

export function aggregateMemberNames(
  aggregate: AggregateApi,
  providers: Provider[],
  t: Translate,
) {
  return aggregate.memberProviderIds.map((id) => {
    const name = providers.find((provider) => provider.id === id)?.name;
    if (!name) return null;
    const conversationCount = aggregate.memberConversationCounts?.[id] ?? 0;
    if (!aggregate.active || conversationCount === 0) return name;
    return `${name} · ${t("providers.aggregate.conversationCount", { count: conversationCount })}`;
  }).filter(Boolean).join(" + ");
}
