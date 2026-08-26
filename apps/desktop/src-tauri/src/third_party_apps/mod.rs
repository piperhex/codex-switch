mod json_targets;
mod yaml_targets;

use std::{fs, path::Path};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime};

use crate::{
    claude_code,
    codex_config::{LOCAL_PROXY_BASE_URL, LOCAL_PROXY_TOKEN},
    models::{
        AppSettings, ModelApiFormats, ModelContextWindows, ModelReasoningEfforts,
        ProviderApiFormat, ProviderKind, ProviderProfile, ThirdPartyAppWriteSettings,
    },
    providers::DEFAULT_OFFICIAL_MODEL,
    storage::{read_app_settings, read_state, resolve_paths, write_app_settings},
};

pub(crate) const MANAGED_PROVIDER_ID: &str = "codex-switch";
const KNOWN_OFFICIAL_MODELS: [&str; 3] = ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ProviderProtocol {
    Anthropic,
    OpenaiResponses,
    OpenaiChat,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ThirdPartyAppId {
    ClaudeCode,
    OpenCode,
    OpenClaw,
    HermesAgent,
    Trae,
    WorkBuddy,
    ZCode,
    DeepSeekHarness,
    OpenViking,
}

pub(crate) fn provider_protocol(provider: &ProviderProfile) -> ProviderProtocol {
    if provider.name.eq_ignore_ascii_case("Claude Code") {
        return ProviderProtocol::Anthropic;
    }
    match provider.api_format {
        crate::models::ProviderApiFormat::OpenaiResponses => ProviderProtocol::OpenaiResponses,
        crate::models::ProviderApiFormat::OpenaiChat => ProviderProtocol::OpenaiChat,
    }
}

pub(crate) fn provider_context_window(provider: &ProviderProfile) -> u64 {
    provider
        .model_context_windows
        .get(&provider.model)
        .copied()
        .or(provider.context_window)
        .unwrap_or(128_000)
}

pub(crate) fn effective_settings(settings: &AppSettings) -> ThirdPartyAppWriteSettings {
    settings
        .third_party_app_write
        .clone()
        .unwrap_or_else(|| settings.claude_code_write_target.into())
}

pub(crate) fn should_write_codex_for_settings(settings: &AppSettings) -> bool {
    effective_settings(settings).write_codex
}

pub(crate) fn should_write_app(settings: &AppSettings, app: ThirdPartyAppId) -> bool {
    let settings = effective_settings(settings);
    if !settings.enabled {
        return false;
    }
    match app {
        ThirdPartyAppId::ClaudeCode => settings.apps.claude_code,
        ThirdPartyAppId::OpenCode => settings.apps.open_code,
        ThirdPartyAppId::OpenClaw => settings.apps.open_claw,
        ThirdPartyAppId::HermesAgent => settings.apps.hermes_agent,
        ThirdPartyAppId::Trae => settings.apps.trae,
        ThirdPartyAppId::WorkBuddy => settings.apps.work_buddy,
        ThirdPartyAppId::ZCode => settings.apps.z_code,
        ThirdPartyAppId::DeepSeekHarness => settings.apps.deep_seek_harness,
        ThirdPartyAppId::OpenViking => settings.apps.open_viking,
    }
}

#[tauri::command]
pub(crate) async fn set_third_party_app_write_settings<R: Runtime + 'static>(
    app: AppHandle<R>,
    settings: ThirdPartyAppWriteSettings,
) -> Result<AppSettings, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let previous = read_app_settings(&app)?;
        let mut next = previous.clone();
        next.third_party_app_write = Some(settings);
        write_app_settings(&app, &next)?;
        if let Err(error) = sync_after_switch(&app) {
            write_app_settings(&app, &previous)?;
            return Err(format!("无法保存三方 App 写入设置：{error}"));
        }
        Ok(next)
    })
    .await
    .map_err(|error| format!("保存三方 App 写入设置失败：{error}"))?
}

pub(crate) fn sync_after_switch<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let settings = read_app_settings(app)?;
    let provider = active_provider(app)?;
    let official_context_window = settings.gpt_5_6_sol_context_window;
    let home = dirs::home_dir().ok_or_else(|| "无法定位用户主目录".to_string())?;
    let mut errors = Vec::new();

    if should_write_app(&settings, ThirdPartyAppId::ClaudeCode) {
        let state = read_state(&resolve_paths(app)?);
        let result = if let Some(provider) = provider.as_ref() {
            if let Err(error) = crate::claude_desktop::write_provider_proxy_settings(provider) {
                errors.push(format!("Claude Desktop：{error}"));
            }
            claude_code::write_provider_settings(
                Some(provider),
                &effective_settings(&settings).claude_subagent_model,
            )
        } else if state.local_proxy_enabled && state.active_account_id.is_some() {
            if let Err(error) =
                crate::claude_desktop::write_official_proxy_settings(official_context_window)
            {
                errors.push(format!("Claude Desktop：{error}"));
            }
            claude_code::write_official_proxy_settings(
                &effective_settings(&settings).claude_subagent_model,
            )
        } else {
            if let Err(error) = crate::claude_desktop::clear_proxy_settings() {
                errors.push(format!("Claude Desktop：{error}"));
            }
            claude_code::write_provider_settings(
                None,
                &effective_settings(&settings).claude_subagent_model,
            )
        };
        if let Err(error) = result {
            errors.push(format!("Claude Code：{error}"));
        }
    }
    sync_json_targets(&settings, &home, provider.as_ref(), &mut errors);
    sync_yaml_targets(&settings, &home, provider.as_ref(), &mut errors);
    // TRAE currently exposes model configuration only through its UI and has no
    // stable documented local provider file, so enabling it is intentionally a no-op.
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("；"))
    }
}

fn sync_json_targets(
    settings: &AppSettings,
    home: &Path,
    provider: Option<&ProviderProfile>,
    errors: &mut Vec<String>,
) {
    let mut context = JsonSyncContext {
        settings,
        home,
        provider,
        errors,
    };
    context.sync(ThirdPartyAppId::OpenCode, json_targets::sync_open_code);
    context.sync(ThirdPartyAppId::OpenClaw, json_targets::sync_open_claw);
    context.sync(ThirdPartyAppId::ZCode, json_targets::sync_z_code);
    context.sync(ThirdPartyAppId::WorkBuddy, json_targets::sync_work_buddy);
    context.sync(ThirdPartyAppId::OpenViking, json_targets::sync_open_viking);
}

fn sync_yaml_targets(
    settings: &AppSettings,
    home: &Path,
    provider: Option<&ProviderProfile>,
    errors: &mut Vec<String>,
) {
    if should_write_app(settings, ThirdPartyAppId::HermesAgent) {
        if let Err(error) = yaml_targets::sync_hermes(home, provider) {
            errors.push(format!("Hermes Agent：{error}"));
        }
    }
    if should_write_app(settings, ThirdPartyAppId::DeepSeekHarness) {
        if let Err(error) = yaml_targets::sync_deep_seek(home, provider) {
            errors.push(format!("DeepSeek Harness：{error}"));
        }
    }
}

struct JsonSyncContext<'a> {
    settings: &'a AppSettings,
    home: &'a Path,
    provider: Option<&'a ProviderProfile>,
    errors: &'a mut Vec<String>,
}

impl<'a> JsonSyncContext<'a> {
    fn sync<F>(&mut self, app: ThirdPartyAppId, sync: F)
    where
        F: Fn(&Path, Option<&ProviderProfile>) -> Result<(), String>,
    {
        if !should_write_app(self.settings, app) {
            return;
        }
        if let Err(error) = sync(self.home, self.provider) {
            self.errors.push(format!("{}：{error}", app_label(app)));
        }
    }
}

fn app_label(app: ThirdPartyAppId) -> &'static str {
    match app {
        ThirdPartyAppId::ClaudeCode => "Claude Code",
        ThirdPartyAppId::OpenCode => "OpenCode",
        ThirdPartyAppId::OpenClaw => "OpenClaw",
        ThirdPartyAppId::HermesAgent => "Hermes Agent",
        ThirdPartyAppId::Trae => "TRAE",
        ThirdPartyAppId::WorkBuddy => "WorkBuddy",
        ThirdPartyAppId::ZCode => "ZCode",
        ThirdPartyAppId::DeepSeekHarness => "DeepSeek Harness",
        ThirdPartyAppId::OpenViking => "OpenViking",
    }
}

fn active_provider<R: Runtime>(app: &AppHandle<R>) -> Result<Option<ProviderProfile>, String> {
    let paths = resolve_paths(app)?;
    let state = read_state(&paths);
    if let Some(id) = state.active_provider_id.as_deref() {
        if crate::aggregate_api::is_active_id(id) {
            let config = crate::aggregate_api::read_active_config(&paths, id)?;
            let profiles = crate::aggregate_api::member_profiles(&paths, &config)?;
            return Ok(Some(crate::aggregate_api::logical_profile(
                &config, &profiles,
            )?));
        }
        return Ok(Some(crate::providers::read_provider(&paths, id)?));
    }
    if let Some(group) = state.active_provider_group.as_deref() {
        return crate::providers::provider_group_profiles(&paths, group)
            .map(|providers| providers.into_iter().next());
    }
    if state.local_proxy_enabled
        && state.active_account_id.is_some()
        && crate::local_proxy::is_running()
    {
        let context_window = read_app_settings(app)?.gpt_5_6_sol_context_window;
        let models = official_local_proxy_models(&paths.codex_home);
        return Ok(Some(official_local_proxy_profile(context_window, models)));
    }
    Ok(None)
}

fn official_local_proxy_profile(context_window: u64, models: Vec<String>) -> ProviderProfile {
    let model = DEFAULT_OFFICIAL_MODEL.to_string();
    let mut models = models;
    for known_model in KNOWN_OFFICIAL_MODELS {
        if !models.iter().any(|candidate| candidate == known_model) {
            models.push(known_model.to_string());
        }
    }
    ProviderProfile {
        id: MANAGED_PROVIDER_ID.to_string(),
        kind: ProviderKind::OpenAi,
        name: "Codex Switch".to_string(),
        group: String::new(),
        base_url: LOCAL_PROXY_BASE_URL.to_string(),
        api_key: LOCAL_PROXY_TOKEN.to_string(),
        model: model.clone(),
        models,
        model_reasoning_efforts: ModelReasoningEfforts::new(),
        model_context_windows: ModelContextWindows::new(),
        model_api_formats: ModelApiFormats::new(),
        image_input_models: Vec::new(),
        image_input_models_configured: false,
        context_window: Some(context_window),
        model_selection_controlled_by_codex: true,
        api_format: ProviderApiFormat::OpenaiResponses,
        balance_platform: None,
        balance_query_url: None,
        balance_query_token: None,
        wallet_query_url: None,
        wallet_query_token: None,
        wallet_username: None,
        wallet_password: None,
    }
}

fn official_local_proxy_models(codex_home: &Path) -> Vec<String> {
    let path = codex_home.join("codex-switch-model-catalog.json");
    let Ok(source) = fs::read_to_string(path) else {
        return Vec::new();
    };
    let Ok(catalog) = serde_json::from_str::<serde_json::Value>(&source) else {
        return Vec::new();
    };
    let Some(entries) = catalog.get("models").and_then(serde_json::Value::as_array) else {
        return Vec::new();
    };
    let mut models = Vec::new();
    for entry in entries {
        let Some(model) = ["slug", "id"]
            .into_iter()
            .find_map(|field| entry.get(field).and_then(serde_json::Value::as_str))
        else {
            continue;
        };
        let model = model.trim();
        if !model.is_empty() && !models.iter().any(|known| known == model) {
            models.push(model.to_string());
        }
    }
    if !models.iter().any(|model| model == DEFAULT_OFFICIAL_MODEL) {
        models.insert(0, DEFAULT_OFFICIAL_MODEL.to_string());
    }
    models
}

#[cfg(test)]
pub(crate) mod tests {
    use std::collections::BTreeMap;

    use super::*;
    use crate::models::{
        ClaudeCodeWriteTarget, ModelApiFormats, ModelReasoningEfforts, ProviderApiFormat,
        ProviderKind,
    };

    pub(crate) fn provider() -> ProviderProfile {
        ProviderProfile {
            id: MANAGED_PROVIDER_ID.to_string(),
            kind: ProviderKind::Custom,
            name: "Gateway".to_string(),
            group: String::new(),
            base_url: "https://api.example.com/v1".to_string(),
            api_key: "secret".to_string(),
            model: "test-model".to_string(),
            models: vec!["test-model".to_string()],
            model_reasoning_efforts: ModelReasoningEfforts::new(),
            model_context_windows: BTreeMap::from([("test-model".to_string(), 64_000)]),
            model_api_formats: ModelApiFormats::new(),
            image_input_models: Vec::new(),
            image_input_models_configured: false,
            context_window: None,
            model_selection_controlled_by_codex: true,
            api_format: ProviderApiFormat::OpenaiChat,
            balance_platform: None,
            balance_query_url: None,
            balance_query_token: None,
            wallet_query_url: None,
            wallet_query_token: None,
            wallet_username: None,
            wallet_password: None,
        }
    }

    #[test]
    fn legacy_targets_map_to_new_settings() {
        let settings = AppSettings {
            claude_code_write_target: ClaudeCodeWriteTarget::All,
            ..AppSettings::default()
        };
        let effective = effective_settings(&settings);
        assert!(effective.enabled);
        assert!(effective.write_codex);
        assert!(effective.apps.claude_code);
    }

    #[test]
    fn official_local_proxy_profile_targets_the_responses_endpoint() {
        let profile = official_local_proxy_profile(1_000_000, Vec::new());
        assert_eq!(profile.base_url, LOCAL_PROXY_BASE_URL);
        assert_eq!(profile.api_key, LOCAL_PROXY_TOKEN);
        assert_eq!(profile.api_format, ProviderApiFormat::OpenaiResponses);
        assert_eq!(
            profile.models,
            vec![
                "gpt-5.6-sol".to_string(),
                "gpt-5.6-terra".to_string(),
                "gpt-5.6-luna".to_string()
            ]
        );
        assert_eq!(profile.context_window, Some(1_000_000));
    }
}
