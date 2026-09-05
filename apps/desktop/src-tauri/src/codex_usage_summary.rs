use std::collections::HashMap;

use chrono::{Local, TimeZone};
use serde::Serialize;

use crate::{
    codex_usage_cost_rates as rates,
    models::{ManagerStateFile, ProviderProfile, TokenUsageEntry, UsageSummary},
    storage::Paths,
};

mod provider_cost;

use provider_cost::ProviderEstimatedCost;

struct CostContext<'a> {
    rates: &'a rates::CostRates,
    profiles: &'a [ProviderProfile],
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodexUsageSummary {
    enabled: bool,
    total_tokens: u64,
    estimated_cost_usd: f64,
    primary_remaining_percent: Option<f64>,
    primary_remaining_aggregated: bool,
    provider_estimated_cost: Option<ProviderEstimatedCost>,
}

pub(crate) fn load() -> Result<CodexUsageSummary, String> {
    let app = crate::codex_runtime::runtime_app_handle()
        .ok_or_else(|| "Codex runtime is not initialized.".to_string())?;
    let settings = crate::storage::read_app_settings(&app)?;
    if !settings.codex_usage_summary_enabled {
        return Ok(CodexUsageSummary {
            enabled: false,
            total_tokens: 0,
            estimated_cost_usd: 0.0,
            primary_remaining_percent: None,
            primary_remaining_aggregated: false,
            provider_estimated_cost: None,
        });
    }
    let paths = crate::storage::resolve_paths(&app)?;
    let state = crate::storage::read_state(&paths);
    let primary_remaining = displayed_primary_remaining(&paths, &state);
    let entries = crate::local_proxy::list_token_usage_entries_since_blocking(
        &app,
        local_day_start_timestamp()?,
    )?;
    let profiles = crate::providers::list_provider_profiles(&paths)?;
    let rates = rates::load(&paths)?;
    let costs = CostContext {
        rates: &rates,
        profiles: &profiles,
    };
    let provider_estimated_cost = provider_cost::load(&paths, &state, &entries, &costs)?;
    Ok(summarize(
        &entries,
        primary_remaining,
        provider_estimated_cost,
        &costs,
    ))
}

fn displayed_primary_remaining(paths: &Paths, state: &ManagerStateFile) -> Option<(f64, bool)> {
    if state.active_provider_id.is_some() || state.active_provider_group.is_some() {
        return None;
    }
    if !state.concurrent_account_routing_enabled {
        let account_id = state.active_account_id.as_deref()?;
        let usage = crate::storage::load_usage(&crate::storage::usage_path(paths, account_id));
        return primary_remaining(&usage).map(|remaining| (remaining, false));
    }
    let account_ids = crate::local_proxy::enabled_concurrent_account_ids(paths, state).ok()?;
    let usages = account_ids
        .iter()
        .map(|account_id| {
            crate::storage::load_usage(&crate::storage::usage_path(paths, account_id))
        })
        .collect::<Vec<_>>();
    sum_primary_remaining(&usages).map(|remaining| (remaining, true))
}

fn primary_remaining(usage: &UsageSummary) -> Option<f64> {
    usage
        .primary
        .as_ref()
        .map(|primary| primary.remaining_percent)
        .filter(|remaining| remaining.is_finite())
        .map(|remaining| remaining.clamp(0.0, 100.0))
}

fn sum_primary_remaining(usages: &[UsageSummary]) -> Option<f64> {
    usages
        .iter()
        .filter_map(primary_remaining)
        .reduce(|total, remaining| total + remaining)
}

fn local_day_start_timestamp() -> Result<u64, String> {
    let midnight = Local::now()
        .date_naive()
        .and_hms_opt(0, 0, 0)
        .ok_or_else(|| "Could not determine the start of today.".to_string())?;
    let timestamp = Local
        .from_local_datetime(&midnight)
        .earliest()
        .ok_or_else(|| "Could not resolve the start of today.".to_string())?
        .timestamp();
    u64::try_from(timestamp).map_err(|_| "The start of today is before the Unix epoch.".to_string())
}

fn summarize(
    entries: &[TokenUsageEntry],
    primary_remaining: Option<(f64, bool)>,
    provider_estimated_cost: Option<ProviderEstimatedCost>,
    costs: &CostContext<'_>,
) -> CodexUsageSummary {
    CodexUsageSummary {
        enabled: true,
        total_tokens: entries
            .iter()
            .map(entry_total_tokens)
            .fold(0, u64::saturating_add),
        estimated_cost_usd: sum_estimated_cost(entries, costs),
        primary_remaining_percent: primary_remaining.map(|(remaining, _)| remaining),
        primary_remaining_aggregated: primary_remaining.is_some_and(|(_, aggregated)| aggregated),
        provider_estimated_cost,
    }
}

fn entry_total_tokens(entry: &TokenUsageEntry) -> u64 {
    entry.total_tokens.unwrap_or_else(|| {
        entry
            .input_tokens
            .unwrap_or(0)
            .saturating_add(entry.output_tokens.unwrap_or(0))
    })
}

fn sum_estimated_cost(entries: &[TokenUsageEntry], costs: &CostContext<'_>) -> f64 {
    let by_id: HashMap<_, _> = costs
        .profiles
        .iter()
        .map(|profile| (profile.id.as_str(), profile))
        .collect();
    let mut by_name = HashMap::new();
    for profile in costs.profiles {
        by_name
            .entry(profile.name.trim().to_lowercase())
            .or_insert(profile);
    }
    entries
        .iter()
        .map(|entry| {
            let profile = match entry.provider_id.as_deref() {
                Some(id) => by_id.get(id),
                None => by_name.get(&entry.provider.trim().to_lowercase()),
            };
            costs.rates.estimate_cost(entry, profile.copied())
        })
        .sum()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn summarize_defaults(
        entries: &[TokenUsageEntry],
        primary_remaining: Option<(f64, bool)>,
        provider_estimated_cost: Option<ProviderEstimatedCost>,
    ) -> CodexUsageSummary {
        summarize(
            entries,
            primary_remaining,
            provider_estimated_cost,
            &CostContext {
                rates: &rates::CostRates::default(),
                profiles: &[],
            },
        )
    }

    fn usage_entry(model: &str) -> TokenUsageEntry {
        TokenUsageEntry {
            id: "entry".to_string(),
            ts: 0,
            provider: "provider".to_string(),
            provider_id: None,
            account_id: None,
            account_email: None,
            model: model.to_string(),
            duration_ms: None,
            input_tokens: Some(1_000_000),
            output_tokens: Some(100_000),
            reasoning_tokens: None,
            cached_tokens: Some(200_000),
            total_tokens: Some(1_100_000),
            model_context_window: None,
        }
    }

    #[test]
    fn summarizes_tokens_and_estimated_model_cost() {
        let summary = summarize_defaults(&[usage_entry("gpt-5.6-sol")], None, None);

        assert_eq!(summary.total_tokens, 1_100_000);
        assert!((summary.estimated_cost_usd - 5.28).abs() < f64::EPSILON);
    }

    #[test]
    fn global_estimate_uses_provider_prices_and_selected_reference() {
        let rates = serde_json::from_value(serde_json::json!({
            "referenceModel": "gpt-6-astra", "modelTokenCosts": {"relay": {"gpt-5.6-sol": 2.0}},
        }))
        .unwrap();
        let profiles = vec![serde_json::from_value(serde_json::json!({
            "id": "relay", "name": "Relay", "kind": "custom", "baseUrl": "https://example.test/v1",
            "apiKey": "test", "model": "private-model", "apiFormat": "openaiResponses",
        }))
        .unwrap()];
        let mut configured = usage_entry("gpt-5.6-sol");
        configured.provider_id = Some("relay".to_string());
        let entries = [configured, usage_entry("private-model")];
        let costs = CostContext {
            rates: &rates,
            profiles: &profiles,
        };
        let summary = summarize(&entries, None, None, &costs);

        assert!((summary.estimated_cost_usd - 15.4).abs() < 1e-10);
    }

    #[test]
    fn sums_primary_remaining_for_concurrent_accounts() {
        let usage = |remaining_percent| UsageSummary {
            primary: Some(crate::models::UsageWindow {
                used_percent: 100.0 - remaining_percent,
                remaining_percent,
                resets_at: None,
                window_minutes: None,
            }),
            ..UsageSummary::default()
        };

        assert_eq!(
            sum_primary_remaining(&[usage(79.0), usage(65.0)]),
            Some(144.0)
        );
    }

    #[test]
    fn global_estimate_resolves_legacy_names_for_custom_rules() {
        let rates = serde_json::from_value(serde_json::json!({
            "customRules": [{ "providerId": "relay", "model": "gpt-5.6-sol",
                "input": 3.0, "cachedInput": 0.5, "output": 20.0 }],
        }))
        .unwrap();
        let profiles = vec![serde_json::from_value(serde_json::json!({
            "id": "relay", "name": "Relay", "kind": "custom", "baseUrl": "https://example.test/v1",
            "apiKey": "test", "model": "private-model", "apiFormat": "openaiResponses",
        }))
        .unwrap()];
        let mut entry = usage_entry("gpt-5.6-sol");
        entry.provider = " Relay ".to_string();
        let costs = CostContext {
            rates: &rates,
            profiles: &profiles,
        };
        let summary = summarize(std::slice::from_ref(&entry), None, None, &costs);

        assert_eq!(summary.estimated_cost_usd, 4.5);
        entry.provider_id = Some("unrelated-provider".to_string());
        let summary = summarize(&[entry], None, None, &costs);
        assert_eq!(summary.estimated_cost_usd, 5.28);
    }

    #[test]
    fn serializes_provider_cost_without_wallet_data() {
        let summary = summarize_defaults(
            &[],
            None,
            Some(ProviderEstimatedCost {
                amount_usd: 2.5,
                aggregated: true,
            }),
        );
        let value = serde_json::to_value(summary).unwrap();

        assert_eq!(value["providerEstimatedCost"]["amountUsd"], 2.5);
        assert_eq!(value["providerEstimatedCost"]["aggregated"], true);
        assert!(value.get("providerWalletBalance").is_none());
    }
}
