use serde_json::Value;

use super::{
    api_format_for_base_url, bailian_static_models, models_url, parse_models, preset_spec,
    reusable_api_key, ModelSource, PresetProviderId,
};
use crate::models::{ProviderApiFormat, ProviderProfile};

pub(crate) fn inspect_preset_for_test(
    id: PresetProviderId,
    base_url: &str,
    payload: Option<&Value>,
) -> Result<(ProviderApiFormat, String, Vec<String>), String> {
    let spec = preset_spec(id);
    let url = if spec.model_source == ModelSource::BailianStatic {
        super::validate_base_url(spec, base_url)?
    } else {
        models_url(spec, base_url)?
    };
    let models = match (spec.model_source, payload) {
        (ModelSource::BailianStatic, _) => bailian_static_models(base_url)?,
        (_, Some(payload)) => parse_models(spec, payload)?,
        _ => Vec::new(),
    };
    Ok((
        api_format_for_base_url(spec, base_url),
        url.to_string(),
        models,
    ))
}

pub(crate) fn reusable_api_key_for_test(
    provider: &ProviderProfile,
    id: PresetProviderId,
    base_url: &str,
) -> Option<String> {
    reusable_api_key(provider, id, base_url)
}
