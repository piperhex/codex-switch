use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
};

use crate::models::ProviderApiFormat;

#[derive(Hash, PartialEq, Eq)]
struct ProviderModelKey {
    provider_id: String,
    model: String,
}

struct CachedApiFormat {
    base_url: String,
    format: ProviderApiFormat,
}

static API_FORMAT_CACHE: OnceLock<Mutex<HashMap<ProviderModelKey, CachedApiFormat>>> =
    OnceLock::new();

pub(crate) fn cached_format(
    provider_id: &str,
    base_url: &str,
    model: &str,
) -> Option<ProviderApiFormat> {
    let key = cache_key(provider_id, model);
    let mut cache = cache().lock().ok()?;
    let normalized_base_url = normalized_base_url(base_url);
    if cache
        .get(&key)
        .is_some_and(|entry| entry.base_url == normalized_base_url)
    {
        return cache.get(&key).map(|entry| entry.format);
    }
    cache.remove(&key);
    None
}

pub(crate) fn remember_format(
    provider_id: &str,
    base_url: &str,
    model: &str,
    format: ProviderApiFormat,
) {
    let Ok(mut cache) = cache().lock() else {
        // Protocol detection is best-effort and must never fail a provider request.
        return;
    };
    cache.insert(
        cache_key(provider_id, model),
        CachedApiFormat {
            base_url: normalized_base_url(base_url),
            format,
        },
    );
}

pub(crate) fn forget_format(provider_id: &str, model: &str) {
    let Ok(mut cache) = cache().lock() else {
        return;
    };
    cache.remove(&cache_key(provider_id, model));
}

fn cache() -> &'static Mutex<HashMap<ProviderModelKey, CachedApiFormat>> {
    API_FORMAT_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn cache_key(provider_id: &str, model: &str) -> ProviderModelKey {
    ProviderModelKey {
        provider_id: provider_id.to_string(),
        model: model.trim().to_string(),
    }
}

fn normalized_base_url(base_url: &str) -> String {
    base_url.trim().trim_end_matches('/').to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn caches_formats_independently_for_each_provider_model() {
        remember_format(
            "cache-provider-a",
            "https://relay.example.com/v1",
            "model-a",
            ProviderApiFormat::OpenaiChat,
        );
        remember_format(
            "cache-provider-a",
            "https://relay.example.com/v1",
            "model-b",
            ProviderApiFormat::OpenaiResponses,
        );

        assert_eq!(
            cached_format(
                "cache-provider-a",
                "https://relay.example.com/v1/",
                "model-a"
            ),
            Some(ProviderApiFormat::OpenaiChat)
        );
        assert_eq!(
            cached_format(
                "cache-provider-a",
                "https://relay.example.com/v1",
                "model-b"
            ),
            Some(ProviderApiFormat::OpenaiResponses)
        );
        assert_eq!(
            cached_format(
                "cache-provider-b",
                "https://relay.example.com/v1",
                "model-a"
            ),
            None
        );
    }

    #[test]
    fn changing_the_provider_endpoint_invalidates_cached_formats() {
        remember_format(
            "cache-provider-endpoint",
            "https://old.example.com/v1",
            "model-a",
            ProviderApiFormat::OpenaiChat,
        );

        assert_eq!(
            cached_format(
                "cache-provider-endpoint",
                "https://new.example.com/v1",
                "model-a"
            ),
            None
        );
    }
}
