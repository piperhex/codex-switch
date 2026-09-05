use std::collections::{HashMap, HashSet};

use serde::Serialize;

use crate::{
    aggregate_api::{self, AggregateApiConfig},
    models::{ManagerStateFile, ProviderKind, ProviderProfile, TokenUsageEntry},
    storage::Paths,
};

use super::rates::CostRates;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ProviderEstimatedCost {
    pub(super) amount_usd: f64,
    pub(super) aggregated: bool,
}

struct ProviderCostScope {
    ids: HashSet<String>,
    legacy_names: HashSet<String>,
    aggregated: bool,
}

impl ProviderCostScope {
    fn from_providers(profiles: &[&ProviderProfile], aggregated: bool) -> Self {
        Self {
            ids: profiles.iter().map(|profile| profile.id.clone()).collect(),
            legacy_names: profiles
                .iter()
                .map(|profile| normalized_name(&profile.name))
                .collect(),
            aggregated,
        }
    }

    fn from_aggregate(config: &AggregateApiConfig, profiles: &[ProviderProfile]) -> Self {
        let ids: HashSet<_> = config.member_provider_ids.iter().cloned().collect();
        let members = profiles
            .iter()
            .filter(|profile| ids.contains(&profile.id))
            .collect::<Vec<_>>();
        let mut scope = Self::from_providers(&members, true);
        // Older aggregate requests were recorded under the logical API identity.
        // Include them once alongside member requests, even after a member is removed.
        scope.ids = ids;
        scope.ids.insert(aggregate_api::active_id(&config.id));
        scope.legacy_names.insert(normalized_name(&config.name));
        scope
    }

    fn contains(&self, entry: &TokenUsageEntry) -> bool {
        match entry.provider_id.as_deref() {
            Some(id) => self.ids.contains(id),
            None => self
                .legacy_names
                .contains(&normalized_name(&entry.provider)),
        }
    }
}

fn normalized_name(name: &str) -> String {
    name.trim().to_lowercase()
}

pub(super) fn load(
    paths: &Paths,
    state: &ManagerStateFile,
    entries: &[TokenUsageEntry],
    costs: &super::CostContext<'_>,
) -> Result<Option<ProviderEstimatedCost>, String> {
    if state.active_provider_id.is_none() && state.active_provider_group.is_none() {
        return Ok(None);
    }
    let scope = active_scope(paths, state, costs.profiles)?;
    Ok(scope.map(|scope| summarize(entries, &scope, costs.rates, costs.profiles)))
}

fn active_scope(
    paths: &Paths,
    state: &ManagerStateFile,
    profiles: &[ProviderProfile],
) -> Result<Option<ProviderCostScope>, String> {
    if let Some(group) = state.active_provider_group.as_deref() {
        let members = profiles
            .iter()
            .filter(|profile| profile.kind == ProviderKind::Custom && profile.group == group)
            .collect::<Vec<_>>();
        return Ok(Some(ProviderCostScope::from_providers(&members, true)));
    }
    let Some(id) = state.active_provider_id.as_deref() else {
        return Ok(None);
    };
    if aggregate_api::is_active_id(id) {
        let config = aggregate_api::read_active_config(paths, id)?;
        return Ok(Some(ProviderCostScope::from_aggregate(&config, profiles)));
    }
    let members = profiles
        .iter()
        .filter(|profile| profile.id == id)
        .collect::<Vec<_>>();
    let mut scope = ProviderCostScope::from_providers(&members, false);
    scope.ids.insert(id.to_string());
    Ok(Some(scope))
}

fn summarize(
    entries: &[TokenUsageEntry],
    scope: &ProviderCostScope,
    rates: &CostRates,
    profiles: &[ProviderProfile],
) -> ProviderEstimatedCost {
    let by_id: HashMap<_, _> = profiles
        .iter()
        .map(|profile| (profile.id.as_str(), profile))
        .collect();
    let mut by_name = HashMap::new();
    for profile in profiles
        .iter()
        .filter(|profile| scope.ids.contains(&profile.id))
    {
        by_name
            .entry(normalized_name(&profile.name))
            .or_insert(profile);
    }
    let amount_usd = entries
        .iter()
        .filter(|entry| scope.contains(entry))
        .map(|entry| {
            let profile = match entry.provider_id.as_deref() {
                Some(id) => by_id.get(id),
                None => by_name.get(&normalized_name(&entry.provider)),
            };
            rates.estimate_cost(entry, profile.copied())
        })
        .sum();
    ProviderEstimatedCost {
        amount_usd,
        aggregated: scope.aggregated,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn profile(id: &str, name: &str) -> ProviderProfile {
        serde_json::from_value(serde_json::json!({
            "id": id, "name": name, "kind": "custom", "baseUrl": "https://example.test/v1",
            "apiKey": "test", "model": "private-model", "apiFormat": "openaiResponses"
        }))
        .unwrap()
    }

    fn entry(provider_id: Option<&str>, provider: &str) -> TokenUsageEntry {
        serde_json::from_value(serde_json::json!({
            "id": "request", "ts": 1, "providerId": provider_id, "provider": provider,
            "model": "private-model", "inputTokens": 1_000_000, "cachedTokens": 200_000,
            "outputTokens": 100_000
        }))
        .unwrap()
    }

    fn config() -> AggregateApiConfig {
        AggregateApiConfig {
            id: "pool".to_string(),
            name: "Pool".to_string(),
            model: "private-model".to_string(),
            member_provider_ids: vec![
                "first".to_string(),
                "second".to_string(),
                "first".to_string(),
            ],
            enabled: true,
        }
    }

    fn test_paths() -> Paths {
        let root = std::env::temp_dir().join(format!(
            "codex-switch-provider-cost-test-{}",
            uuid::Uuid::new_v4()
        ));
        Paths {
            current_auth: root.join("codex-home/auth.json"),
            current_config: root.join("codex-home/config.toml"),
            codex_home: root.join("codex-home"),
            accounts: root.join("accounts"),
            providers: root.join("providers"),
            config_backup: root.join("config-before-provider.toml"),
            state_file: root.join("state.json"),
        }
    }

    #[test]
    fn official_routing_has_no_provider_cost_and_needs_no_provider_store() {
        let state = ManagerStateFile::default();
        let costs = super::super::CostContext {
            rates: &CostRates::default(),
            profiles: &[],
        };
        assert!(load(&test_paths(), &state, &[], &costs).unwrap().is_none());
        assert!(active_scope(&test_paths(), &state, &[]).unwrap().is_none());
    }

    #[test]
    fn active_group_takes_precedence_and_only_contains_its_custom_members() {
        let mut member = profile("first", "First");
        member.group = "Selected".to_string();
        let mut different_group = profile("second", "Second");
        different_group.group = "Other".to_string();
        let mut different_kind = profile("third", "Third");
        different_kind.group = "Selected".to_string();
        different_kind.kind = ProviderKind::OpenAi;
        let state = ManagerStateFile {
            active_provider_group: Some("Selected".to_string()),
            active_provider_id: Some("second".to_string()),
            ..ManagerStateFile::default()
        };
        let profiles = [member, different_group, different_kind];
        let scope = active_scope(&test_paths(), &state, &profiles)
            .unwrap()
            .unwrap();

        assert!(scope.aggregated);
        assert!(scope.contains(&entry(Some("first"), "First")));
        assert!(!scope.contains(&entry(Some("second"), "Second")));
        assert!(!scope.contains(&entry(Some("third"), "Third")));
    }

    #[test]
    fn active_aggregate_reads_saved_members_including_unavailable_profiles() {
        let paths = test_paths();
        let root = paths.providers.parent().unwrap();
        crate::storage::write_json_atomic(
            &root.join("aggregate-apis.json"),
            &serde_json::json!([config()]),
        )
        .unwrap();
        let state = ManagerStateFile {
            active_provider_id: Some("aggregate:pool".to_string()),
            ..ManagerStateFile::default()
        };
        let scope = active_scope(&paths, &state, &[profile("first", "First")])
            .unwrap()
            .unwrap();

        assert!(scope.aggregated);
        assert_eq!(scope.ids.len(), 3);
        assert!(scope.contains(&entry(Some("first"), "First")));
        assert!(scope.contains(&entry(Some("second"), "Second")));
        assert!(scope.contains(&entry(Some("aggregate:pool"), "Pool")));
        assert!(!scope.contains(&entry(Some("aggregate:other"), "Pool")));
        std::fs::remove_file(root.join("aggregate-apis.json")).unwrap();
        std::fs::remove_dir(root).unwrap();
    }

    #[test]
    fn legacy_cost_uses_the_first_matching_profile_within_the_active_scope() {
        let mut unrelated = profile("other", "Shared");
        unrelated.kind = ProviderKind::OpenAi;
        let mut second_match = profile("second", "Shared");
        second_match.kind = ProviderKind::OpenAi;
        let profiles = [unrelated, profile("first", "Shared"), second_match];
        let scope = ProviderCostScope::from_providers(&[&profiles[1], &profiles[2]], true);
        let mut legacy = entry(None, "Shared");
        legacy.model = "gpt-5.6-sol".to_string();
        let rates = serde_json::from_value(serde_json::json!({
            "modelTokenCosts": { "first": { "gpt-5.6-sol": 2.0 } }
        }))
        .unwrap();
        let summary = summarize(&[legacy], &scope, &rates, &profiles);

        assert!((summary.amount_usd - 2.2).abs() < 1e-10);
    }

    #[test]
    fn single_api_counts_all_its_models_and_legacy_entries_only() {
        let profiles = vec![profile("first", "First")];
        let scope = ProviderCostScope::from_providers(&[&profiles[0]], false);
        let mut other_model = entry(Some("first"), "Old name");
        other_model.model = "another-model".to_string();
        let entries = [
            entry(Some("first"), "First"),
            other_model,
            entry(None, " First "),
            entry(Some("other"), "First"),
            entry(None, "Official Codex"),
        ];
        let summary = summarize(&entries, &scope, &CostRates::default(), &profiles);

        assert!((summary.amount_usd - 15.84).abs() < 1e-10);
        assert!(!summary.aggregated);
    }

    #[test]
    fn aggregate_includes_all_members_and_logical_history_once() {
        let profiles = vec![profile("first", "First"), profile("second", "Second")];
        let scope = ProviderCostScope::from_aggregate(&config(), &profiles);
        let entries = [
            entry(Some("first"), "Renamed"),
            entry(Some("second"), "Second"),
            entry(Some("aggregate:pool"), "Pool"),
            entry(None, "Pool"),
            entry(Some("other"), "First"),
            entry(Some("aggregate:other"), "Pool"),
        ];
        let summary = summarize(&entries, &scope, &CostRates::default(), &profiles);

        assert!((summary.amount_usd - 21.12).abs() < 1e-10);
        assert!(summary.aggregated);
    }

    #[test]
    fn empty_usage_still_displays_zero_cost() {
        let scope = ProviderCostScope::from_aggregate(&config(), &[]);
        let summary = summarize(&[], &scope, &CostRates::default(), &[]);
        assert_eq!(summary.amount_usd, 0.0);
        assert!(summary.aggregated);
    }

    #[test]
    fn group_sums_member_apis_without_double_counting_shared_names() {
        let profiles = vec![profile("first", "Shared"), profile("second", "Shared")];
        let scope = ProviderCostScope::from_providers(&profiles.iter().collect::<Vec<_>>(), true);
        let entries = [
            entry(Some("first"), "Shared"),
            entry(Some("second"), "Shared"),
            entry(None, "Shared"),
            entry(Some("other"), "Shared"),
        ];
        let summary = summarize(&entries, &scope, &CostRates::default(), &profiles);
        assert!((summary.amount_usd - 15.84).abs() < 1e-10);
        assert!(summary.aggregated);
    }
}
