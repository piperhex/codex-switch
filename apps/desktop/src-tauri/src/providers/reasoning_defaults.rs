use std::sync::OnceLock;

use crate::models::{ModelReasoningEfforts, ReasoningEffort};

const BUNDLED_REASONING_DEFAULTS: &str = include_str!("../../../src/modelReasoningDefaults.json");

/// Defaults describe distinct reasoning modes, excluding aliases for the same upstream mode.
pub(super) fn known_model_reasoning_efforts(model: &str) -> Option<&'static [ReasoningEffort]> {
    static DEFAULTS: OnceLock<ModelReasoningEfforts> = OnceLock::new();
    let defaults = DEFAULTS.get_or_init(|| {
        // This bundled constant is validated by tests; malformed data is a build-time defect.
        serde_json::from_str(BUNDLED_REASONING_DEFAULTS)
            .expect("Bundled model reasoning defaults must contain valid reasoning efforts")
    });
    let normalized = model.trim().to_ascii_lowercase();
    let name = normalized.rsplit('/').next()?;
    defaults.get(name).map(Vec::as_slice)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_defaults_are_valid_and_have_distinct_nonempty_efforts() {
        let defaults: ModelReasoningEfforts =
            serde_json::from_str(BUNDLED_REASONING_DEFAULTS).unwrap();
        assert_eq!(defaults.len(), 35);
        for (model, efforts) in defaults {
            assert!(!efforts.is_empty(), "{model}");
            for (index, effort) in efforts.iter().enumerate() {
                assert!(!efforts[..index].contains(effort), "{model}");
            }
            assert_eq!(
                known_model_reasoning_efforts(&model),
                Some(efforts.as_slice())
            );
        }
    }

    #[test]
    fn namespaced_models_match_without_guessing_unknown_versions() {
        assert_eq!(
            known_model_reasoning_efforts(" ZHIPU/GLM-5.3-Flash "),
            Some(
                [
                    ReasoningEffort::Low,
                    ReasoningEffort::High,
                    ReasoningEffort::Max
                ]
                .as_slice()
            )
        );
        assert_eq!(known_model_reasoning_efforts("glm-5.30"), None);
        assert_eq!(known_model_reasoning_efforts("unknown-model"), None);
    }
}
