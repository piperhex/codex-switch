use std::{path::PathBuf, process::Command, thread, time::Duration};

use serde_json::{json, Map, Value};
use sysinfo::{ProcessesToUpdate, System};
use tauri::{AppHandle, Runtime};

use crate::{
    models::{AppSettings, ClaudeCodeWriteTarget, ManagerStateFile, ProviderProfile},
    storage::{
        read_app_settings, read_json, read_state, resolve_paths, write_app_settings,
        write_json_atomic,
    },
};

const CLAUDE_SETTINGS_FILE: &str = "settings.json";
const ANTHROPIC_BASE_URL: &str = "ANTHROPIC_BASE_URL";
const ANTHROPIC_AUTH_TOKEN: &str = "ANTHROPIC_AUTH_TOKEN";
const ANTHROPIC_API_KEY: &str = "ANTHROPIC_API_KEY";
const ANTHROPIC_MODEL: &str = "ANTHROPIC_MODEL";
const ANTHROPIC_DEFAULT_SONNET_MODEL: &str = "ANTHROPIC_DEFAULT_SONNET_MODEL";

#[tauri::command]
pub(crate) async fn set_claude_code_write_target<R: Runtime + 'static>(
    app: AppHandle<R>,
    target: ClaudeCodeWriteTarget,
) -> Result<AppSettings, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut settings = read_app_settings(&app)?;
        let previous_target = settings.claude_code_write_target;
        settings.claude_code_write_target = target;
        write_app_settings(&app, &settings)?;
        if let Err(error) = sync_current_target(&app) {
            eprintln!("Claude Code configuration sync failed: {error}");
            settings.claude_code_write_target = previous_target;
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

pub(crate) fn should_write_claude(settings: &AppSettings) -> bool {
    matches!(
        settings.claude_code_write_target,
        ClaudeCodeWriteTarget::All | ClaudeCodeWriteTarget::ClaudeCode
    )
}

pub(crate) fn should_write_codex(settings: &AppSettings) -> bool {
    matches!(
        settings.claude_code_write_target,
        ClaudeCodeWriteTarget::All | ClaudeCodeWriteTarget::Codex
    )
}

pub(crate) fn should_write_codex_for_app<R: Runtime>(app: &AppHandle<R>) -> Result<bool, String> {
    read_app_settings(app).map(|settings| should_write_codex(&settings))
}

pub(crate) fn sync_current_target<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let settings = read_app_settings(app)?;
    if !should_write_claude(&settings) {
        return Ok(());
    }

    let paths = resolve_paths(app)?;
    let state = read_state(&paths);
    let provider = active_provider(&paths, &state)?;
    write_settings(provider.as_ref())
}

pub(crate) fn sync_after_switch<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    sync_current_target(app).map_err(|error| {
        eprintln!("Claude Code configuration sync failed: {error}");
        "切换已完成，但无法写入 Claude Code 配置。请检查配置文件后重试。".to_string()
    })
}

fn active_provider(
    paths: &crate::storage::Paths,
    state: &ManagerStateFile,
) -> Result<Option<ProviderProfile>, String> {
    if let Some(id) = state.active_provider_id.as_deref() {
        if crate::aggregate_api::is_active_id(id) {
            let config = crate::aggregate_api::read_active_config(paths, id)?;
            let profiles = crate::aggregate_api::member_profiles(paths, &config)?;
            return Ok(Some(crate::aggregate_api::logical_profile(
                &config, &profiles,
            )?));
        }
        return Ok(Some(crate::providers::read_provider(paths, id)?));
    }
    if let Some(group) = state.active_provider_group.as_deref() {
        return crate::providers::provider_group_profiles(paths, group)
            .map(|providers| providers.into_iter().next());
    }
    Ok(None)
}

fn claude_settings_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "无法定位用户主目录".to_string())?;
    Ok(home.join(".claude").join(CLAUDE_SETTINGS_FILE))
}

fn write_settings(provider: Option<&ProviderProfile>) -> Result<(), String> {
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
        Some(provider) => apply_provider_environment(env, provider),
        None => clear_provider_environment(env),
    }

    write_json_atomic(&path, &settings)
}

fn apply_provider_environment(env: &mut Map<String, Value>, provider: &ProviderProfile) {
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
    env.remove(ANTHROPIC_API_KEY);
    env.insert(
        ANTHROPIC_AUTH_TOKEN.into(),
        Value::String(provider.api_key.clone()),
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
        ANTHROPIC_DEFAULT_SONNET_MODEL,
    ] {
        env.remove(key);
    }
}

fn claude_process_running() -> bool {
    let mut system = System::new_all();
    system.refresh_processes(ProcessesToUpdate::All, true);
    system.processes().values().any(is_claude_code_process)
}

fn is_claude_code_process(process: &sysinfo::Process) -> bool {
    let name = process.name().to_string_lossy().to_ascii_lowercase();
    if name == "claude" || name == "claude.exe" {
        return true;
    }
    process.cmd().iter().any(|argument| {
        let argument = argument.to_string_lossy().to_ascii_lowercase();
        argument.contains("@anthropic-ai/claude-code") || argument.contains("claude-code/cli.js")
    })
}

fn ensure_claude_available() -> Result<(), String> {
    #[cfg(windows)]
    let status = Command::new("where.exe").arg("claude").status();
    #[cfg(not(windows))]
    let status = Command::new("which").arg("claude").status();

    match status {
        Ok(status) if status.success() => Ok(()),
        _ => Err("未找到 Claude Code。请先安装 Claude Code，并确保 claude 命令可用。".to_string()),
    }
}

fn spawn_claude() -> Result<(), String> {
    ensure_claude_available()?;
    #[cfg(windows)]
    {
        Command::new("cmd")
            .args(["/C", "start", "Claude Code", "cmd", "/K", "claude"])
            .spawn()
            .map_err(|error| format!("无法启动 Claude Code：{error}"))?;
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .args(["-a", "Claude Code"])
            .spawn()
            .map_err(|error| format!("无法启动 Claude Code：{error}"))?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("claude")
            .spawn()
            .map_err(|error| format!("无法启动 Claude Code：{error}"))?;
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn launch_claude_code<R: Runtime + 'static>(
    _app: AppHandle<R>,
) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if claude_process_running() {
            return Ok(false);
        }
        spawn_claude()?;
        Ok(true)
    })
    .await
    .map_err(|_| "启动 Claude Code 失败，请重试。".to_string())?
}

#[tauri::command]
pub(crate) async fn restart_claude_code<R: Runtime + 'static>(
    _app: AppHandle<R>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut system = System::new_all();
        system.refresh_processes(ProcessesToUpdate::All, true);
        let mut kill_failed = false;
        for process in system.processes().values() {
            if is_claude_code_process(process) {
                kill_failed |= !process.kill();
            }
        }
        if kill_failed {
            return Err("无法关闭正在运行的 Claude Code，请手动关闭后重试。".to_string());
        }
        thread::sleep(Duration::from_millis(300));
        spawn_claude()
    })
    .await
    .map_err(|_| "重启 Claude Code 失败，请重试。".to_string())?
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
    fn write_targets_enable_only_the_selected_applications() {
        let mut settings = AppSettings::default();
        assert!(should_write_codex(&settings));
        assert!(!should_write_claude(&settings));

        settings.claude_code_write_target = ClaudeCodeWriteTarget::All;
        assert!(should_write_codex(&settings));
        assert!(should_write_claude(&settings));

        settings.claude_code_write_target = ClaudeCodeWriteTarget::ClaudeCode;
        assert!(!should_write_codex(&settings));
        assert!(should_write_claude(&settings));
    }
}
