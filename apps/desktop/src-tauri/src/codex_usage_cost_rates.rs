use std::{
    collections::BTreeMap,
    fmt, fs, io,
    path::PathBuf,
    sync::{LazyLock, Mutex},
};

use serde::{Deserialize, Serialize};

use crate::{
    models::{ProviderKind, ProviderProfile, TokenUsageEntry},
    storage::Paths,
};

const RATES_FILE_NAME: &str = "codex-usage-cost-rates.json";
const MAX_RULES: usize = 10_000;
const MAX_MODEL_PRICES: usize = 100_000;
const MAX_IDENTIFIER_LENGTH: usize = 512;
const MAX_TOKEN_RATE: f64 = 1_000_000_000.0;
const TOKENS_PER_MILLION: f64 = 1_000_000.0;
static RATES_WRITE_LOCK: Mutex<()> = Mutex::new(());
static PRESET_CATALOG: LazyLock<CostPresetCatalog> = LazyLock::new(|| {
    // This is a bundled build artifact; malformed data cannot be repaired at runtime.
    serde_json::from_str(include_str!("../../src/data/tokenCostPresets.json"))
        .expect("The bundled token-cost preset catalog must be valid JSON")
});

/// A desktop copy of the existing price settings, in USD per million tokens.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CostRates {
    #[serde(default = "default_reference_model")]
    reference_model: String,
    #[serde(default)]
    custom_rules: Vec<CustomCostRule>,
    #[serde(default)]
    model_token_costs: BTreeMap<String, BTreeMap<String, f64>>,
}

impl Default for CostRates {
    fn default() -> Self {
        Self {
            reference_model: default_reference_model(),
            custom_rules: Vec::new(),
            model_token_costs: BTreeMap::new(),
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CostPresetCatalog {
    default_reference_model: String,
    models: Vec<CostPreset>,
}

#[derive(Deserialize)]
struct CostPreset {
    model: String,
    #[serde(default)]
    aliases: Vec<String>,
    #[serde(flatten)]
    rate: CostRate,
}

impl CostPresetCatalog {
    fn rate_for_reference(&self, model: &str) -> Option<CostRate> {
        self.models
            .iter()
            .find(|preset| preset.model == model)
            .map(|preset| preset.rate)
    }

    fn rate_for_model(&self, model: &str) -> Option<CostRate> {
        let normalized = model.trim().to_lowercase();
        self.models
            .iter()
            .filter(|preset| {
                normalized == preset.model
                    || preset.aliases.contains(&normalized)
                    || normalized.starts_with(&format!("{}-", preset.model))
            })
            .max_by_key(|preset| preset.model.len())
            .map(|preset| preset.rate)
    }

    fn default_rate(&self) -> CostRate {
        // The bundled catalog must provide the default it declares; covered by catalog tests.
        self.rate_for_reference(&self.default_reference_model)
            .expect("The bundled token-cost catalog must contain its default reference model")
    }
}

fn default_reference_model() -> String {
    PRESET_CATALOG.default_reference_model.clone()
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CustomCostRule {
    provider_id: String,
    model: String,
    #[serde(flatten)]
    rate: CostRate,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CostRate {
    input: f64,
    cached_input: f64,
    output: f64,
}

#[derive(Debug)]
enum CostRatesError {
    Invalid,
    Unavailable,
}

impl fmt::Display for CostRatesError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Invalid => "预估成本价格设置无效。",
            Self::Unavailable => "暂时无法更新预估成本价格，请稍后重试。",
        })
    }
}

impl std::error::Error for CostRatesError {}

impl CostRate {
    const fn new(input: f64, cached_input: f64, output: f64) -> Self {
        Self {
            input,
            cached_input,
            output,
        }
    }

    fn estimate(self, entry: &TokenUsageEntry) -> f64 {
        let input = entry.input_tokens.unwrap_or(0);
        let cached = entry.cached_tokens.unwrap_or(0).min(input);
        let output = entry.output_tokens.unwrap_or(0);
        ((input - cached) as f64 * self.input
            + cached as f64 * self.cached_input
            + output as f64 * self.output)
            / TOKENS_PER_MILLION
    }
}

impl CostRates {
    // Native summaries currently consume estimates only on Windows and macOS.
    #[cfg_attr(not(any(target_os = "windows", target_os = "macos")), allow(dead_code))]
    pub(crate) fn estimate_cost(
        &self,
        entry: &TokenUsageEntry,
        provider: Option<&ProviderProfile>,
    ) -> f64 {
        let provider_id = provider
            .map(|provider| provider.id.as_str())
            .or(entry.provider_id.as_deref());
        if let Some(rate) = self.custom_rate(provider_id, &entry.model) {
            return rate.estimate(entry);
        }
        let configured = provider
            .filter(|provider| provider.kind == ProviderKind::Custom)
            .and_then(|provider| self.model_token_costs.get(&provider.id))
            .and_then(|models| models.get(&entry.model))
            .map(|rate| CostRate::new(*rate, *rate, *rate));
        let rate = configured
            .or_else(|| PRESET_CATALOG.rate_for_model(&entry.model))
            .or_else(|| PRESET_CATALOG.rate_for_reference(&self.reference_model))
            .unwrap_or_else(|| PRESET_CATALOG.default_rate());
        rate.estimate(entry)
    }

    fn custom_rate(&self, provider_id: Option<&str>, model: &str) -> Option<CostRate> {
        let provider_id = provider_id?;
        let model = model.trim().to_lowercase();
        // A model-specific override wins over a broader version-prefix rule.
        self.custom_rules
            .iter()
            .filter(|rule| {
                let configured = rule.model.trim().to_lowercase();
                rule.provider_id == provider_id
                    && (model == configured || model.starts_with(&format!("{configured}-")))
            })
            .min_by_key(|rule| std::cmp::Reverse(rule.model.trim().len()))
            .map(|rule| rule.rate)
    }

    fn validate(&self) -> Result<(), CostRatesError> {
        let rule_count_valid = self.custom_rules.len() <= MAX_RULES;
        let prices_count_valid = self.model_token_costs.len() <= MAX_RULES
            && self
                .model_token_costs
                .values()
                .map(BTreeMap::len)
                .sum::<usize>()
                <= MAX_MODEL_PRICES;
        let rules_valid = self.custom_rules.iter().all(|rule| {
            valid_identifier(&rule.provider_id)
                && valid_identifier(&rule.model)
                && [rule.rate.input, rule.rate.cached_input, rule.rate.output]
                    .into_iter()
                    .all(valid_rate)
        });
        let prices_valid = self.model_token_costs.iter().all(|(provider, models)| {
            valid_identifier(provider)
                && models
                    .iter()
                    .all(|(model, rate)| valid_identifier(model) && valid_rate(*rate))
        });
        let reference_valid = PRESET_CATALOG
            .rate_for_reference(&self.reference_model)
            .is_some();
        if reference_valid && rule_count_valid && prices_count_valid && rules_valid && prices_valid
        {
            Ok(())
        } else {
            Err(CostRatesError::Invalid)
        }
    }
}

fn valid_identifier(value: &str) -> bool {
    !value.trim().is_empty() && value.len() <= MAX_IDENTIFIER_LENGTH
}

fn valid_rate(value: f64) -> bool {
    value.is_finite() && (0.0..=MAX_TOKEN_RATE).contains(&value)
}

fn rates_path(paths: &Paths) -> PathBuf {
    paths.state_file.with_file_name(RATES_FILE_NAME)
}

// Every platform saves rates; only native Windows/macOS summaries load them.
#[cfg_attr(not(any(target_os = "windows", target_os = "macos")), allow(dead_code))]
pub(crate) fn load(paths: &Paths) -> Result<CostRates, String> {
    read_rates(paths).map_err(|error| error.to_string())
}

fn read_rates(paths: &Paths) -> Result<CostRates, CostRatesError> {
    let bytes = match fs::read(rates_path(paths)) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(CostRates::default()),
        Err(_) => return Err(CostRatesError::Unavailable),
    };
    let rates: CostRates = serde_json::from_slice(&bytes).map_err(|_| CostRatesError::Invalid)?;
    rates.validate()?;
    Ok(rates)
}

fn persist(paths: &Paths, rates: &CostRates) -> Result<(), CostRatesError> {
    rates.validate()?;
    let _guard = RATES_WRITE_LOCK
        .lock()
        .map_err(|_| CostRatesError::Unavailable)?;
    let value = serde_json::to_value(rates).map_err(|_| CostRatesError::Invalid)?;
    crate::storage::write_json_if_changed(&rates_path(paths), &value)
        .map_err(|_| CostRatesError::Unavailable)?;
    Ok(())
}

#[tauri::command]
pub(crate) async fn set_codex_usage_cost_rates(
    app: tauri::AppHandle,
    rates: CostRates,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let paths = crate::storage::resolve_paths(&app).map_err(|_| CostRatesError::Unavailable)?;
        persist(&paths, &rates)
    })
    .await
    .map_err(|_| CostRatesError::Unavailable.to_string())?
    .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn usage_entry(model: &str) -> TokenUsageEntry {
        serde_json::from_value(json!({
            "id": "entry", "ts": 0, "provider": "Relay", "providerId": "relay",
            "model": model, "inputTokens": 1_000_000, "cachedTokens": 200_000,
            "outputTokens": 100_000,
        }))
        .unwrap()
    }

    fn provider(kind: ProviderKind) -> ProviderProfile {
        serde_json::from_value(json!({
            "id": "relay", "name": "Relay", "kind": kind, "baseUrl": "https://example.com",
            "apiKey": "", "model": "gpt-5.6-sol", "apiFormat": "openaiResponses",
        }))
        .unwrap()
    }

    #[test]
    fn custom_providers_use_exact_model_prices_before_official_presets() {
        let rates: CostRates = serde_json::from_value(json!({
            "modelTokenCosts": { "relay": { "gpt-5.6-sol": 2.0 } },
        }))
        .unwrap();
        let provider = provider(ProviderKind::Custom);
        assert_eq!(
            rates.estimate_cost(&usage_entry("gpt-5.6-sol"), Some(&provider)),
            2.2
        );
        assert_eq!(
            rates.estimate_cost(&usage_entry("gpt-5.6-sol-dated"), Some(&provider)),
            5.28
        );
    }

    #[test]
    fn custom_rules_override_model_prices_and_match_versioned_names() {
        let rates: CostRates = serde_json::from_value(json!({
            "customRules": [{ "providerId": "relay", "model": "GPT-5.6-SOL",
                "input": 3.0, "cachedInput": 0.5, "output": 20.0 }],
            "modelTokenCosts": { "relay": { "gpt-5.6-sol": 2.0 } },
        }))
        .unwrap();
        let provider = provider(ProviderKind::Custom);
        assert_eq!(
            rates.estimate_cost(&usage_entry("gpt-5.6-sol"), Some(&provider)),
            4.5
        );
        assert_eq!(
            rates.estimate_cost(&usage_entry("gpt-5.6-sol-dated"), None),
            4.5
        );
    }

    #[test]
    fn specific_model_rule_wins_over_an_earlier_prefix_rule() {
        let rates: CostRates = serde_json::from_value(json!({
            "customRules": [
                { "providerId": "relay", "model": "gpt-5.6-sol",
                  "input": 2.0, "cachedInput": 0.5, "output": 3.0 },
                { "providerId": "relay", "model": "gpt-5.6-sol-dated",
                  "input": 9.0, "cachedInput": 1.0, "output": 13.0 }
            ]
        }))
        .unwrap();
        let cost = rates.estimate_cost(&usage_entry("gpt-5.6-sol-dated"), None);
        assert!((cost - 8.7).abs() < 1e-10);
    }

    #[test]
    fn official_providers_ignore_flat_api_prices_and_keep_the_model_preset() {
        let provider = provider(ProviderKind::OpenAi);
        let entry = usage_entry("gpt-5.6-sol");
        let rates: CostRates = serde_json::from_value(json!({
            "modelTokenCosts": { "relay": { "gpt-5.6-sol": 2.0 } },
        }))
        .unwrap();
        assert_eq!(rates.estimate_cost(&entry, Some(&provider)), 5.28,);
    }

    #[test]
    fn cached_tokens_are_clamped_and_reasoning_is_not_charged_twice() {
        let mut entry = usage_entry("private-model");
        entry.cached_tokens = Some(2_000_000);
        entry.reasoning_tokens = Some(100_000);
        assert_eq!(CostRates::default().estimate_cost(&entry, None), 2.4);
    }

    #[test]
    fn rejects_invalid_rates_but_allows_zero_cost() {
        let mut rates = CostRates::default();
        rates
            .model_token_costs
            .insert("relay".into(), BTreeMap::from([("model".into(), 0.0)]));
        assert!(rates.validate().is_ok());
        for invalid in [f64::NAN, f64::INFINITY, -1.0, MAX_TOKEN_RATE + 1.0] {
            rates
                .model_token_costs
                .get_mut("relay")
                .unwrap()
                .insert("model".into(), invalid);
            assert!(rates.validate().is_err());
        }
    }

    #[test]
    fn bundled_catalog_declares_a_priced_default_and_valid_presets() {
        assert_eq!(PRESET_CATALOG.default_reference_model, "gpt-5.6-sol");
        assert!(CostRates::default().validate().is_ok());
        for preset in &PRESET_CATALOG.models {
            assert!(valid_identifier(&preset.model));
            assert!([
                preset.rate.input,
                preset.rate.cached_input,
                preset.rate.output
            ]
            .into_iter()
            .all(valid_rate));
        }
        let rate = PRESET_CATALOG.default_rate();
        assert_eq!(
            (rate.input, rate.cached_input, rate.output),
            (4.0, 0.4, 20.0)
        );
    }

    #[test]
    fn reference_changes_unknown_models_but_preserves_configured_model_presets() {
        let rates: CostRates = serde_json::from_value(json!({
            "referenceModel": "gpt-5.6-luna",
        }))
        .unwrap();
        let provider = provider(ProviderKind::Custom);
        for model in ["private-model", "", "gpt-4o", "gpt-5.6-private-model"] {
            assert!(
                (rates.estimate_cost(&usage_entry(model), Some(&provider)) - 0.284).abs() < 1e-10
            );
        }
        assert_eq!(
            rates.estimate_cost(&usage_entry("gpt-5.6-sol"), Some(&provider)),
            5.28
        );
        assert_eq!(
            rates.estimate_cost(&usage_entry("gpt-5.6"), Some(&provider)),
            5.28
        );
        assert_eq!(
            CostRates::default().estimate_cost(&usage_entry("private-model"), None),
            5.28
        );
    }

    #[test]
    fn spark_has_no_preset_and_uses_the_selected_reference() {
        let rates: CostRates = serde_json::from_value(json!({
            "referenceModel": "gpt-6-astra",
        }))
        .unwrap();
        for model in ["gpt-5.3-codex-spark", "gpt-5.6-spark", "gpt-5-spark"] {
            assert!(PRESET_CATALOG.rate_for_model(model).is_none());
            assert_eq!(rates.estimate_cost(&usage_entry(model), None), 13.2);
        }
    }

    #[test]
    fn model_presets_match_versioned_names_and_choose_the_longest_name() {
        let catalog: CostPresetCatalog = serde_json::from_value(json!({
            "defaultReferenceModel": "model",
            "models": [
                {"model": "model", "input": 1.0, "cachedInput": 1.0, "output": 1.0},
                {"model": "model-mini", "input": 2.0, "cachedInput": 2.0, "output": 2.0},
            ],
        }))
        .unwrap();
        assert_eq!(
            catalog
                .rate_for_model("MODEL-mini-2026-09-01")
                .unwrap()
                .input,
            2.0
        );
        let rate = PRESET_CATALOG
            .rate_for_model("gpt-5.6-terra-2026-09-01")
            .unwrap();
        assert_eq!(
            (rate.input, rate.cached_input, rate.output),
            (2.0, 0.2, 12.0)
        );
    }

    #[test]
    fn reference_settings_accept_only_priced_catalog_models() {
        let old_settings: CostRates = serde_json::from_value(json!({})).unwrap();
        assert_eq!(old_settings.reference_model, "gpt-5.6-sol");
        for model in ["", "gpt-5.3-codex-spark", "gpt-5.6-sol-dated"] {
            let rates = CostRates {
                reference_model: model.to_string(),
                ..CostRates::default()
            };
            assert!(rates.validate().is_err());
        }
        let rates = CostRates {
            reference_model: "gpt-5.6-terra".to_string(),
            ..CostRates::default()
        };
        assert!(rates.validate().is_ok());
    }
}
