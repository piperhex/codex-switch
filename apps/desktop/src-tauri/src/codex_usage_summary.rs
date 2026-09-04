use chrono::{Local, TimeZone};
use serde::Serialize;

use crate::{
    models::{ManagerStateFile, TokenUsageEntry, UsageSummary},
    storage::Paths,
};

const TOKENS_PER_MILLION: f64 = 1_000_000.0;
const SOL_FALLBACK_RATE: TokenCostRate = TokenCostRate::new(1.25, 0.125, 10.0);
const OPENAI_API_RATES: [(&str, TokenCostRate); 17] = [
    ("gpt-5.6-sol", TokenCostRate::new(4.0, 0.4, 20.0)),
    ("gpt-5.6-terra", TokenCostRate::new(2.0, 0.2, 12.0)),
    ("gpt-5.6-luna", TokenCostRate::new(0.2, 0.02, 1.2)),
    ("gpt-4.1-mini", TokenCostRate::new(0.4, 0.1, 1.6)),
    ("gpt-4.1-nano", TokenCostRate::new(0.1, 0.025, 0.4)),
    ("gpt-4o-mini", TokenCostRate::new(0.15, 0.075, 0.6)),
    ("gpt-5.4-mini", TokenCostRate::new(0.75, 0.075, 4.5)),
    ("gpt-5-mini", TokenCostRate::new(0.25, 0.025, 2.0)),
    ("gpt-5-nano", TokenCostRate::new(0.05, 0.005, 0.4)),
    ("gpt-5", TokenCostRate::new(1.25, 0.125, 10.0)),
    ("gpt-5.6", TokenCostRate::new(4.0, 0.4, 20.0)),
    ("gpt-5.5", TokenCostRate::new(5.0, 0.5, 30.0)),
    ("gpt-5.4", TokenCostRate::new(2.5, 0.25, 15.0)),
    ("gpt-4.1", TokenCostRate::new(2.0, 0.5, 8.0)),
    ("gpt-4o", TokenCostRate::new(2.5, 1.25, 10.0)),
    ("o4-mini", TokenCostRate::new(1.1, 0.275, 4.4)),
    ("o3", TokenCostRate::new(2.0, 0.5, 8.0)),
];

#[derive(Clone, Copy)]
struct TokenCostRate {
    input: f64,
    cached_input: f64,
    output: f64,
}

impl TokenCostRate {
    const fn new(input: f64, cached_input: f64, output: f64) -> Self {
        Self {
            input,
            cached_input,
            output,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodexUsageSummary {
    enabled: bool,
    total_tokens: u64,
    estimated_cost_usd: f64,
    primary_remaining_percent: Option<f64>,
    primary_remaining_aggregated: bool,
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
        });
    }
    let paths = crate::storage::resolve_paths(&app)?;
    let state = crate::storage::read_state(&paths);
    let primary_remaining = displayed_primary_remaining(&paths, &state);
    let entries = crate::local_proxy::list_token_usage_entries_since_blocking(
        &app,
        local_day_start_timestamp()?,
    )?;
    Ok(summarize(&entries, primary_remaining))
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
) -> CodexUsageSummary {
    CodexUsageSummary {
        enabled: true,
        total_tokens: entries
            .iter()
            .map(entry_total_tokens)
            .fold(0, u64::saturating_add),
        estimated_cost_usd: entries.iter().map(estimate_cost).sum(),
        primary_remaining_percent: primary_remaining.map(|(remaining, _)| remaining),
        primary_remaining_aggregated: primary_remaining.is_some_and(|(_, aggregated)| aggregated),
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

fn estimate_cost(entry: &TokenUsageEntry) -> f64 {
    let input_tokens = entry.input_tokens.unwrap_or(0);
    let cached_tokens = entry.cached_tokens.unwrap_or(0).min(input_tokens);
    let output_tokens = entry.output_tokens.unwrap_or(0);
    let rate = rate_for_model(&entry.model);
    let uncached_cost = input_tokens.saturating_sub(cached_tokens) as f64 * rate.input;
    let cached_cost = cached_tokens as f64 * rate.cached_input;
    let output_cost = output_tokens as f64 * rate.output;
    (uncached_cost + cached_cost + output_cost) / TOKENS_PER_MILLION
}

fn rate_for_model(model: &str) -> TokenCostRate {
    let normalized = model.trim().to_ascii_lowercase();
    OPENAI_API_RATES
        .iter()
        .find(|(name, _)| normalized == *name || normalized.starts_with(&format!("{name}-")))
        .map(|(_, rate)| *rate)
        .unwrap_or(SOL_FALLBACK_RATE)
}

#[cfg(test)]
mod tests {
    use super::*;

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
        let summary = summarize(&[usage_entry("gpt-5.6-sol")], None);

        assert_eq!(summary.total_tokens, 1_100_000);
        assert!((summary.estimated_cost_usd - 5.28).abs() < f64::EPSILON);
    }

    #[test]
    fn matches_versioned_model_names() {
        let rate = rate_for_model("gpt-5.6-terra-2026-09-01");

        assert_eq!(rate.input, 2.0);
        assert_eq!(rate.cached_input, 0.2);
        assert_eq!(rate.output, 12.0);
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
}
