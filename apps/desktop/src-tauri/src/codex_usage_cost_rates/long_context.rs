use super::{CostRate, TokenUsageEntry, PRESET_CATALOG};
use serde::{Deserialize, Serialize};

/// Long-context pricing applies to every token component of an eligible request.
#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct LongContextCostSettings {
    pub(super) enabled: bool,
    pub(super) threshold_tokens: u64,
    pub(super) input_multiplier: f64,
    pub(super) cached_input_multiplier: f64,
    pub(super) output_multiplier: f64,
}

impl Default for LongContextCostSettings {
    fn default() -> Self {
        PRESET_CATALOG.default_long_context_cost_settings
    }
}

impl LongContextCostSettings {
    pub(super) fn is_valid(&self) -> bool {
        self.threshold_tokens > 0
            && self.threshold_tokens <= PRESET_CATALOG.max_long_context_threshold_tokens
            && [
                self.input_multiplier,
                self.cached_input_multiplier,
                self.output_multiplier,
            ]
            .into_iter()
            .all(|multiplier| {
                multiplier.is_finite()
                    && multiplier > 0.0
                    && multiplier <= PRESET_CATALOG.max_long_context_cost_multiplier
            })
    }

    pub(super) fn adjust_rate(
        &self,
        rate: CostRate,
        entry: &TokenUsageEntry,
        reference_model: &str,
    ) -> CostRate {
        if !self.enabled || entry.input_tokens.unwrap_or(0) <= self.threshold_tokens {
            return rate;
        }
        // Eligibility follows the actual model even when its prices are overridden.
        let preset = PRESET_CATALOG
            .preset_for_model(&entry.model)
            .or_else(|| PRESET_CATALOG.preset_for_reference(reference_model))
            .or_else(|| {
                PRESET_CATALOG.preset_for_reference(&PRESET_CATALOG.default_reference_model)
            });
        if !preset.is_some_and(|preset| preset.long_context_pricing) {
            return rate;
        }
        CostRate::new(
            rate.input * self.input_multiplier,
            rate.cached_input * self.cached_input_multiplier,
            rate.output * self.output_multiplier,
        )
    }
}
