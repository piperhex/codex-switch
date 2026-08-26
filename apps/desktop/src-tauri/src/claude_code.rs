use std::path::PathBuf;

use serde_json::{json, Map, Value};
use tauri::{AppHandle, Runtime};

use crate::{
    codex_config::LOCAL_PROXY_BASE_URL,
    models::{AppSettings, ClaudeCodeWriteTarget, ProviderProfile},
    storage::{read_app_settings, read_json, write_app_settings, write_json_atomic},
};

const CLAUDE_SETTINGS_FILE: &str = "settings.json";
const ANTHROPIC_BASE_URL: &str = "ANTHROPIC_BASE_URL";
const ANTHROPIC_AUTH_TOKEN: &str = "ANTHROPIC_AUTH_TOKEN";
const ANTHROPIC_API_KEY: &str = "ANTHROPIC_API_KEY";
const ANTHROPIC_MODEL: &str = "ANTHROPIC_MODEL";
const ANTHROPIC_DEFAULT_HAIKU_MODEL: &str = "ANTHROPIC_DEFAULT_HAIKU_MODEL";
const ANTHROPIC_DEFAULT_SONNET_MODEL: &str = "ANTHROPIC_DEFAULT_SONNET_MODEL";
const ANTHROPIC_DEFAULT_OPUS_MODEL: &str = "ANTHROPIC_DEFAULT_OPUS_MODEL";
const PROXY_MANAGED_TOKEN: &str = "PROXY_MANAGED";
const CLAUDE_PROXY_HAIKU_MODEL: &str = "claude-haiku-4-5";
const CLAUDE_PROXY_SONNET_MODEL: &str = "claude-sonnet-4-6";
const CLAUDE_PROXY_OPUS_MODEL: &str = "claude-opus-4-8";
const CLAUDE_CODE_SUBAGENT_MODEL: &str = "CLAUDE_CODE_SUBAGENT_MODEL";
const CLAUDE_CODE_ATTRIBUTION_HEADER: &str = "CLAUDE_CODE_ATTRIBUTION_HEADER";

mod process;

#[tauri::command]
pub(crate) async fn launch_claude_code<R: Runtime + 'static>(
    app: AppHandle<R>,
) -> Result<bool, String> {
    process::launch_claude_code(app).await
}

#[tauri::command]
pub(crate) async fn restart_claude_code<R: Runtime + 'static>(
    app: AppHandle<R>,
) -> Result<(), String> {
    process::restart_claude_code(app).await
}

#[tauri::command]
pub(crate) async fn set_claude_code_write_target<R: Runtime + 'static>(
    app: AppHandle<R>,
    target: ClaudeCodeWriteTarget,
) -> Result<AppSettings, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut settings = read_app_settings(&app)?;
        let previous_target = settings.claude_code_write_target;
        let previous_third_party = settings.third_party_app_write;
        settings.claude_code_write_target = target;
        settings.third_party_app_write = Some(target.into());
        write_app_settings(&app, &settings)?;
        if let Err(error) = crate::third_party_apps::sync_after_switch(&app) {
            eprintln!("Claude Code configuration sync failed: {error}");
            settings.claude_code_write_target = previous_target;
            settings.third_party_app_write = previous_third_party;
            write_app_settings(&app, &settings)?;
            return Err(
                "无法更新 Claude Code 配置，写入目标未更改。请检查配置文件后重试。".to_string(),
            );
        }
        Ok(settings)
    })
    .await
    .map_err(|_| "保存写入目标失败，请重试。".to_string())?
}

pub(crate) fn should_write_codex_for_app<R: Runtime>(app: &AppHandle<R>) -> Result<bool, String> {
    read_app_settings(app)
        .map(|settings| crate::third_party_apps::should_write_codex_for_settings(&settings))
}

pub(crate) fn sync_after_switch<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    crate::third_party_apps::sync_after_switch(app).map_err(|error| {
        eprintln!("Third-party app configuration sync failed: {error}");
        format!("切换已完成，但无法写入三方 App 配置：{error}")
    })
}

fn claude_settings_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "无法定位用户主目录".to_string())?;
    Ok(home.join(".claude").join(CLAUDE_SETTINGS_FILE))
}

pub(crate) fn write_provider_settings(
    provider: Option<&ProviderProfile>,
    subagent_model: &str,
) -> Result<(), String> {
    let path = claude_settings_path()?;
    let mut settings = match read_json(&path) {
        Ok(value) if value.is_object() => value,
        Ok(_) => return Err("Claude Code settings.json 必须是 JSON 对象".to_string()),
        Err(_) if !path.exists() => json!({}),
        Err(error) => return Err(error),
    };
    let object = settings
        .as_object_mut()
        .ok_or_else(|| "Claude Code settings.json 必须是 JSON 对象".to_string())?;
    let env = object
        .entry("env")
        .or_insert_with(|| Value::Object(Map::new()))
        .as_object_mut()
        .ok_or_else(|| "Claude Code settings.json 的 env 必须是 JSON 对象".to_string())?;

    match provider {
        Some(provider) => apply_provider_environment(env, provider, subagent_model),
        None => clear_provider_environment(env),
    }

    write_json_atomic(&path, &settings)
}

/// Writes the local proxy endpoint used when the selected route is an official
/// account rather than a third-party Provider.
pub(crate) fn write_official_proxy_settings(subagent_model: &str) -> Result<(), String> {
    let path = claude_settings_path()?;
    let mut settings = match read_json(&path) {
        Ok(value) if value.is_object() => value,
        Ok(_) => return Err("Claude Code settings.json 必须是 JSON 对象".to_string()),
        Err(_) if !path.exists() => json!({}),
        Err(error) => return Err(error),
    };
    let object = settings
        .as_object_mut()
        .ok_or_else(|| "Claude Code settings.json 必须是 JSON 对象".to_string())?;
    let env = object
        .entry("env")
        .or_insert_with(|| Value::Object(Map::new()))
        .as_object_mut()
        .ok_or_else(|| "Claude Code settings.json 的 env 必须是 JSON 对象".to_string())?;
    apply_official_proxy_environment(env, subagent_model);
    write_json_atomic(&path, &settings)
}

fn apply_official_proxy_environment(env: &mut Map<String, Value>, subagent_model: &str) {
    env.insert(
        ANTHROPIC_BASE_URL.into(),
        Value::String(claude_base_url(LOCAL_PROXY_BASE_URL).to_string()),
    );
    env.remove(ANTHROPIC_MODEL);
    env.insert(
        ANTHROPIC_DEFAULT_HAIKU_MODEL.into(),
        Value::String(CLAUDE_PROXY_HAIKU_MODEL.to_string()),
    );
    env.insert(
        ANTHROPIC_DEFAULT_SONNET_MODEL.into(),
        Value::String(CLAUDE_PROXY_SONNET_MODEL.to_string()),
    );
    env.insert(
        ANTHROPIC_DEFAULT_OPUS_MODEL.into(),
        Value::String(CLAUDE_PROXY_OPUS_MODEL.to_string()),
    );
    env.remove(ANTHROPIC_API_KEY);
    env.insert(
        ANTHROPIC_AUTH_TOKEN.into(),
        Value::String(PROXY_MANAGED_TOKEN.to_string()),
    );
    disable_dynamic_attribution(env);
    let subagent_route = match subagent_model {
        "terra" => CLAUDE_PROXY_SONNET_MODEL,
        "luna" => CLAUDE_PROXY_HAIKU_MODEL,
        _ => CLAUDE_PROXY_SONNET_MODEL,
    };
    env.insert(
        CLAUDE_CODE_SUBAGENT_MODEL.into(),
        Value::String(subagent_route.to_string()),
    );
}

fn apply_provider_environment(
    env: &mut Map<String, Value>,
    provider: &ProviderProfile,
    subagent_model: &str,
) {
    let base_url = claude_base_url(&provider.base_url);
    env.insert(
        ANTHROPIC_BASE_URL.into(),
        Value::String(base_url.to_string()),
    );
    env.insert(
        ANTHROPIC_MODEL.into(),
        Value::String(provider.model.clone()),
    );
    env.insert(
        ANTHROPIC_DEFAULT_SONNET_MODEL.into(),
        Value::String(provider.model.clone()),
    );
    let selected_subagent_model = provider
        .models
        .iter()
        .find(|model| model.as_str() == subagent_model)
        .unwrap_or(&provider.model);
    env.insert(
        CLAUDE_CODE_SUBAGENT_MODEL.into(),
        Value::String(selected_subagent_model.clone()),
    );
    env.remove(ANTHROPIC_API_KEY);
    env.insert(
        ANTHROPIC_AUTH_TOKEN.into(),
        Value::String(provider.api_key.clone()),
    );
    disable_dynamic_attribution(env);
}

fn disable_dynamic_attribution(env: &mut Map<String, Value>) {
    env.insert(
        CLAUDE_CODE_ATTRIBUTION_HEADER.into(),
        Value::String("false".to_string()),
    );
}

fn claude_base_url(base_url: &str) -> &str {
    let trimmed = base_url.trim_end_matches('/');
    trimmed.strip_suffix("/v1").unwrap_or(trimmed)
}

fn clear_provider_environment(env: &mut Map<String, Value>) {
    for key in [
        ANTHROPIC_BASE_URL,
        ANTHROPIC_AUTH_TOKEN,
        ANTHROPIC_API_KEY,
        ANTHROPIC_MODEL,
        ANTHROPIC_DEFAULT_HAIKU_MODEL,
        ANTHROPIC_DEFAULT_SONNET_MODEL,
        ANTHROPIC_DEFAULT_OPUS_MODEL,
        CLAUDE_CODE_SUBAGENT_MODEL,
        CLAUDE_CODE_ATTRIBUTION_HEADER,
    ] {
        env.remove(key);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn claude_base_url_removes_only_the_standard_v1_suffix() {
        assert_eq!(
            claude_base_url("https://api.anthropic.com/v1/"),
            "https://api.anthropic.com"
        );
        assert_eq!(
            claude_base_url("https://example.com/api/v1"),
            "https://example.com/api"
        );
        assert_eq!(
            claude_base_url("https://example.com/api"),
            "https://example.com/api"
        );
    }

    #[test]
    fn clearing_provider_environment_preserves_unrelated_claude_settings() {
        let mut env = Map::from_iter([
            (ANTHROPIC_BASE_URL.to_string(), json!("https://example.com")),
            (ANTHROPIC_AUTH_TOKEN.to_string(), json!("secret")),
            ("CLAUDE_CODE_MAX_OUTPUT_TOKENS".to_string(), json!(64000)),
        ]);

        clear_provider_environment(&mut env);

        assert_eq!(
            env.get("CLAUDE_CODE_MAX_OUTPUT_TOKENS"),
            Some(&json!(64000))
        );
        assert!(!env.contains_key(ANTHROPIC_BASE_URL));
        assert!(!env.contains_key(ANTHROPIC_AUTH_TOKEN));
    }

    #[test]
    fn official_proxy_environment_uses_the_local_proxy_route() {
        let mut env = Map::from_iter([(ANTHROPIC_API_KEY.to_string(), json!("stale"))]);

        apply_official_proxy_environment(&mut env, "sol");

        assert_eq!(
            env.get(ANTHROPIC_BASE_URL),
            Some(&json!("http://127.0.0.1:15722"))
        );
        assert!(!env.contains_key(ANTHROPIC_MODEL));
        assert_eq!(
            env.get(ANTHROPIC_DEFAULT_HAIKU_MODEL),
            Some(&json!("claude-haiku-4-5"))
        );
        assert_eq!(
            env.get(ANTHROPIC_DEFAULT_SONNET_MODEL),
            Some(&json!("claude-sonnet-4-6"))
        );
        assert_eq!(
            env.get(ANTHROPIC_DEFAULT_OPUS_MODEL),
            Some(&json!("claude-opus-4-8"))
        );
        assert_eq!(env.get(ANTHROPIC_AUTH_TOKEN), Some(&json!("PROXY_MANAGED")));
        assert!(!env.contains_key(ANTHROPIC_API_KEY));
        assert_eq!(
            env.get(CLAUDE_CODE_SUBAGENT_MODEL),
            Some(&json!("claude-sonnet-4-6"))
        );
        assert_eq!(
            env.get(CLAUDE_CODE_ATTRIBUTION_HEADER),
            Some(&json!("false"))
        );
    }

    #[test]
    fn write_targets_enable_only_the_selected_applications() {
        let mut settings = AppSettings::default();
        assert!(crate::third_party_apps::should_write_codex_for_settings(
            &settings
        ));
        assert!(!crate::third_party_apps::should_write_app(
            &settings,
            crate::third_party_apps::ThirdPartyAppId::ClaudeCode,
        ));

        settings.claude_code_write_target = ClaudeCodeWriteTarget::All;
        assert!(crate::third_party_apps::should_write_codex_for_settings(
            &settings
        ));
        assert!(crate::third_party_apps::should_write_app(
            &settings,
            crate::third_party_apps::ThirdPartyAppId::ClaudeCode,
        ));

        settings.claude_code_write_target = ClaudeCodeWriteTarget::ClaudeCode;
        assert!(!crate::third_party_apps::should_write_codex_for_settings(
            &settings
        ));
        assert!(crate::third_party_apps::should_write_app(
            &settings,
            crate::third_party_apps::ThirdPartyAppId::ClaudeCode,
        ));
    }
}
