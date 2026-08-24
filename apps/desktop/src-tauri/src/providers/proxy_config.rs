fn backup_codex_config_if_needed(paths: &Paths, entering_provider: bool) -> Result<(), String> {
    if !entering_provider {
        return Ok(());
    }
    if paths.config_backup.exists() {
        let existing = fs::read_to_string(&paths.config_backup)
            .map_err(|error| format!("Failed to read Codex config backup: {error}"))?;
        if !existing.trim().is_empty() {
            return Ok(());
        }
        fs::remove_file(&paths.config_backup)
            .map_err(|error| format!("Failed to clear empty Codex config backup: {error}"))?;
    }
    if !paths.current_config.exists() {
        return Ok(());
    }
    let backup = fs::read_to_string(&paths.current_config)
        .map_err(|error| format!("Failed to read Codex config: {error}"))?;
    if backup.trim().is_empty() {
        return Ok(());
    }
    write_text_atomic(&paths.config_backup, &backup)
}

pub(crate) fn write_official_local_proxy_config(paths: &Paths) -> Result<(), String> {
    sync_local_proxy_auth_before_config_write(paths, LocalProxyConfigTarget::Official)?;
    write_local_proxy_config(
        paths,
        LOCAL_PROXY_PROVIDER_NAME,
        Some(DEFAULT_OFFICIAL_MODEL),
        false,
    )
}

fn write_provider_local_proxy_config(
    paths: &Paths,
    provider: &ProviderProfile,
) -> Result<(), String> {
    sync_local_proxy_auth_before_config_write(paths, LocalProxyConfigTarget::Provider)?;
    let uses_local_catalog = !uses_upstream_official_models(provider);
    if uses_local_catalog {
        write_provider_model_catalog(paths, provider)?;
    }
    write_local_proxy_config(
        paths,
        &provider.name,
        Some(codex_model_for_provider(provider)),
        uses_local_catalog,
    )
}

#[derive(Clone, Copy)]
enum LocalProxyConfigTarget {
    Official,
    Provider,
}

// Provider requests read their official credentials from the managed account store, so the live
// Codex auth file can be cleared while a third-party Provider is active. Keeping that file empty
// prevents Codex's background account polling from treating an old OAuth credential as current.
fn sync_local_proxy_auth_before_config_write(
    paths: &Paths,
    target: LocalProxyConfigTarget,
) -> Result<(), String> {
    let state = read_state(paths);
    if matches!(target, LocalProxyConfigTarget::Official)
        || state.local_proxy_openai_auth_account_id.is_none()
    {
        sync_local_proxy_openai_auth_for_state(paths, &state)?;
    }
    Ok(())
}

fn write_active_provider_config(paths: &Paths, provider: &ProviderProfile) -> Result<(), String> {
    ensure_local_proxy_running_for_provider()?;
    write_provider_local_proxy_config(paths, provider)
}

fn provider_switch_supported(proxy_running: bool) -> bool {
    proxy_running
}

fn ensure_local_proxy_running_for_provider() -> Result<(), String> {
    if crate::local_proxy::is_running() {
        Ok(())
    } else {
        Err("Third-party Providers require the local proxy. Start the local proxy before switching Provider."
            .to_string())
    }
}

pub(crate) fn provider_context_window(provider: &ProviderProfile) -> u64 {
    provider
        .context_window
        .unwrap_or(DEFAULT_MODEL_CONTEXT_WINDOW)
}

pub(crate) fn effective_provider_context_window(provider: &ProviderProfile) -> u64 {
    provider_context_window(provider).saturating_mul(95) / 100
}

pub(crate) fn effective_provider_context_window_for_model(
    provider: &ProviderProfile,
    model: &str,
) -> u64 {
    provider
        .model_context_windows
        .get(model)
        .copied()
        .unwrap_or_else(|| {
            default_context_window_for_model(model, provider_context_window(provider))
        })
        .saturating_mul(95)
        / 100
}

fn default_context_window_for_model(model: &str, provider_default: u64) -> u64 {
    if model.trim().to_ascii_lowercase().starts_with("deepseek-") {
        DEFAULT_DEEPSEEK_MODEL_CONTEXT_WINDOW
    } else {
        provider_default
    }
}

struct ModelCatalogOptions<'a> {
    image_input_models: &'a [String],
    reasoning_efforts: &'a ModelReasoningEfforts,
    context_windows: &'a ModelContextWindows,
    default_context_window: u64,
    reasoning_profile: ReasoningEffortProfile,
}

fn write_provider_group_local_proxy_config(
    paths: &Paths,
    group: &str,
    providers: &[ProviderProfile],
) -> Result<(), String> {
    sync_local_proxy_auth_before_config_write(paths, LocalProxyConfigTarget::Provider)?;
    let catalog = model_catalog_for_provider_group_with_image_route(
        providers,
        image_input_route_enabled(paths),
    );
    write_json_if_changed(&paths.codex_home.join(MODEL_CATALOG_FILENAME), &catalog)?;
    let selected_model = provider_group_catalog_data(providers)
        .models
        .into_iter()
        .next()
        .ok_or_else(|| "Provider group does not contain any models".to_string())?;
    write_local_proxy_config(paths, group, Some(&selected_model), true)
}

struct ProviderGroupCatalogData {
    models: Vec<String>,
    image_input_models: Vec<String>,
    reasoning_efforts: ModelReasoningEfforts,
    context_windows: ModelContextWindows,
}

fn provider_group_catalog_data(providers: &[ProviderProfile]) -> ProviderGroupCatalogData {
    let mut data = ProviderGroupCatalogData {
        models: Vec::new(),
        image_input_models: Vec::new(),
        reasoning_efforts: ModelReasoningEfforts::new(),
        context_windows: ModelContextWindows::new(),
    };
    for provider in providers {
        for model in group_visible_models(provider) {
            let display_name = provider_group_model_name(provider, model);
            if !data.models.contains(&display_name) {
                data.models.push(display_name.clone());
            }
            if provider
                .image_input_models
                .iter()
                .any(|value| value == model)
            {
                data.image_input_models.push(display_name.clone());
            }
            if let Some(efforts) = provider.model_reasoning_efforts.get(model) {
                data.reasoning_efforts
                    .insert(display_name.clone(), efforts.clone());
            }
            let context_window = provider
                .model_context_windows
                .get(model)
                .copied()
                .unwrap_or_else(|| {
                    default_context_window_for_model(model, provider_context_window(provider))
                });
            data.context_windows.insert(display_name, context_window);
        }
    }
    data
}
