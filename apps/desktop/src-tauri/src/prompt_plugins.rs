use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager, Runtime};

use crate::models::SystemPromptRule;

pub(crate) const MAX_PROMPT_PLUGIN_FILTER_TEXT: usize = 500;
pub(crate) const MAX_PROMPT_PLUGIN_INJECTION_TEXT: usize = 5000;

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum PromptPluginType {
    Injection,
    Filter,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PromptPluginItem {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) version: String,
    pub(crate) r#type: PromptPluginType,
    pub(crate) text: String,
    #[serde(default)]
    pub(crate) uploader_id: Option<String>,
    #[serde(default)]
    pub(crate) install_count: u64,
    #[serde(default)]
    pub(crate) created_at: String,
    #[serde(default)]
    pub(crate) updated_at: String,
    #[serde(default)]
    pub(crate) installed: bool,
    #[serde(default)]
    pub(crate) installed_version: Option<String>,
    #[serde(default)]
    pub(crate) enabled: bool,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PromptPluginRegistry {
    pub(crate) installed: BTreeMap<String, InstalledPromptPlugin>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InstalledPromptPlugin {
    pub(crate) version: String,
    pub(crate) r#type: PromptPluginType,
    pub(crate) name: String,
    pub(crate) text: String,
    #[serde(default = "enabled_by_default")]
    pub(crate) enabled: bool,
}

const fn enabled_by_default() -> bool {
    true
}

pub(crate) fn apply_installed_prompt_plugin(
    rules: &mut Vec<SystemPromptRule>,
    registry: &mut PromptPluginRegistry,
    plugin: &PromptPluginItem,
) -> Result<(), String> {
    validate_plugin(plugin)?;
    let previous = registry.installed.get(&plugin.id).cloned();
    let previous_enabled = previous.as_ref().map(|value| value.enabled);
    let (_, limit) = plugin_limits(plugin.r#type);
    if let Some(previous) = previous {
        rules.retain(|rule| !rule.text.eq_ignore_ascii_case(&previous.text));
    }
    if rules
        .iter()
        .any(|rule| rule.text.eq_ignore_ascii_case(plugin.text.trim()))
    {
        return Err("This prompt already exists in your rules".to_string());
    }
    if rules.len() >= 100 {
        return Err("You can add up to 100 prompt rules".to_string());
    }
    if plugin.text.trim().chars().count() > limit {
        return Err("Prompt text is too long".to_string());
    }
    rules.push(SystemPromptRule {
        name: plugin.name.trim().to_string(),
        text: plugin.text.trim().to_string(),
        enabled: previous_enabled.unwrap_or(true),
    });
    registry.installed.insert(
        plugin.id.clone(),
        InstalledPromptPlugin {
            version: plugin.version.clone(),
            r#type: plugin.r#type,
            name: plugin.name.clone(),
            text: plugin.text.trim().to_string(),
            enabled: previous_enabled.unwrap_or(true),
        },
    );
    Ok(())
}

pub(crate) fn remove_installed_prompt_plugin(
    rules: &mut Vec<SystemPromptRule>,
    registry: &mut PromptPluginRegistry,
    plugin_id: &str,
) {
    if let Some(installed) = registry.installed.remove(plugin_id) {
        rules.retain(|rule| !rule.text.eq_ignore_ascii_case(&installed.text));
    }
}

pub(crate) fn set_installed_prompt_plugin_enabled(
    rules: &mut [SystemPromptRule],
    registry: &mut PromptPluginRegistry,
    plugin_id: &str,
    enabled: bool,
) -> Result<(), String> {
    let installed = registry
        .installed
        .get_mut(plugin_id)
        .ok_or_else(|| "Install this prompt plugin before changing its status".to_string())?;
    installed.enabled = enabled;
    if let Some(rule) = rules
        .iter_mut()
        .find(|rule| rule.text.eq_ignore_ascii_case(&installed.text))
    {
        rule.enabled = enabled;
    }
    Ok(())
}

fn plugin_limits(plugin_type: PromptPluginType) -> (PromptPluginType, usize) {
    let limit = match plugin_type {
        PromptPluginType::Filter => MAX_PROMPT_PLUGIN_FILTER_TEXT,
        PromptPluginType::Injection => MAX_PROMPT_PLUGIN_INJECTION_TEXT,
    };
    (plugin_type, limit)
}

fn validate_plugin(plugin: &PromptPluginItem) -> Result<(), String> {
    if plugin.id.trim().is_empty()
        || plugin.name.trim().is_empty()
        || plugin.version.trim().is_empty()
        || plugin.text.trim().is_empty()
    {
        return Err("Prompt plugin fields cannot be empty".to_string());
    }
    if !plugin
        .version
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || "._+-".contains(character))
    {
        return Err("Prompt plugin version contains unsupported characters".to_string());
    }
    Ok(())
}

fn registry_path<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join("prompt-plugin-state.json"))
        .map_err(|error| format!("Could not resolve prompt plugin state: {error}"))
}

fn read_registry<R: Runtime>(app: &tauri::AppHandle<R>) -> PromptPluginRegistry {
    registry_path(app)
        .ok()
        .and_then(|path| std::fs::read(path).ok())
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

fn write_registry<R: Runtime>(
    app: &tauri::AppHandle<R>,
    registry: &PromptPluginRegistry,
) -> Result<(), String> {
    let value = serde_json::to_value(registry)
        .map_err(|error| format!("Could not serialize prompt plugin state: {error}"))?;
    crate::storage::write_json_atomic(&registry_path(app)?, &value)
}

#[tauri::command]
pub(crate) async fn list_prompt_plugins<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
) -> Result<Vec<PromptPluginItem>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut items = crate::cloud::fetch_prompt_plugins(&app)?;
        let registry = read_registry(&app);
        for item in &mut items {
            if let Some(installed) = registry.installed.get(&item.id) {
                item.installed_version = Some(installed.version.clone());
                item.installed = installed.version == item.version;
                item.enabled = installed.enabled;
            }
        }
        Ok(items)
    })
    .await
    .map_err(|error| format!("Prompt plugin list task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn publish_prompt_plugin<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    plugin_id: Option<String>,
    name: String,
    version: String,
    r#type: PromptPluginType,
    text: String,
) -> Result<PromptPluginItem, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::cloud::publish_prompt_plugin(
            &app,
            plugin_id.as_deref(),
            &name,
            &version,
            r#type,
            &text,
        )
    })
    .await
    .map_err(|error| format!("Prompt plugin publish task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn install_prompt_plugin<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    plugin_id: String,
) -> Result<(), String> {
    let app_for_fetch = app.clone();
    let fetch_id = plugin_id.clone();
    let plugin = tauri::async_runtime::spawn_blocking(move || {
        crate::cloud::fetch_prompt_plugin(&app_for_fetch, &fetch_id)
    })
    .await
    .map_err(|error| format!("Prompt plugin install task failed: {error}"))??;
    let mut status = crate::local_proxy::get_local_proxy_status(app.clone()).await?;
    let mut registry = read_registry(&app);
    let rules = match plugin.r#type {
        PromptPluginType::Filter => &mut status.system_prompt_filter_rules,
        PromptPluginType::Injection => &mut status.system_prompt_injection_prompts,
    };
    apply_installed_prompt_plugin(rules, &mut registry, &plugin)?;
    match plugin.r#type {
        PromptPluginType::Filter => {
            crate::local_proxy::set_system_prompt_filter_rules(
                app.clone(),
                status.system_prompt_filter_rules,
            )
            .await?;
        }
        PromptPluginType::Injection => {
            crate::local_proxy::set_system_prompt_injection_prompts(
                app.clone(),
                status.system_prompt_injection_prompts,
            )
            .await?;
        }
    }
    write_registry(&app, &registry)?;
    app.emit("providers-changed", ())
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub(crate) async fn remove_prompt_plugin<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    plugin_id: String,
) -> Result<(), String> {
    let mut registry = read_registry(&app);
    let Some(installed) = registry.installed.get(&plugin_id).cloned() else {
        return Ok(());
    };
    let mut status = crate::local_proxy::get_local_proxy_status(app.clone()).await?;
    let rules = match installed.r#type {
        PromptPluginType::Filter => &mut status.system_prompt_filter_rules,
        PromptPluginType::Injection => &mut status.system_prompt_injection_prompts,
    };
    remove_installed_prompt_plugin(rules, &mut registry, &plugin_id);
    match installed.r#type {
        PromptPluginType::Filter => {
            crate::local_proxy::set_system_prompt_filter_rules(
                app.clone(),
                status.system_prompt_filter_rules,
            )
            .await?;
        }
        PromptPluginType::Injection => {
            crate::local_proxy::set_system_prompt_injection_prompts(
                app.clone(),
                status.system_prompt_injection_prompts,
            )
            .await?;
        }
    }
    write_registry(&app, &registry)
}

#[tauri::command]
pub(crate) async fn set_prompt_plugin_enabled<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    plugin_id: String,
    enabled: bool,
) -> Result<(), String> {
    let mut registry = read_registry(&app);
    let Some(installed) = registry.installed.get(&plugin_id).cloned() else {
        return Err("Install this prompt plugin before changing its status".to_string());
    };
    let mut status = crate::local_proxy::get_local_proxy_status(app.clone()).await?;
    let rules = match installed.r#type {
        PromptPluginType::Filter => &mut status.system_prompt_filter_rules,
        PromptPluginType::Injection => &mut status.system_prompt_injection_prompts,
    };
    set_installed_prompt_plugin_enabled(rules, &mut registry, &plugin_id, enabled)?;
    match installed.r#type {
        PromptPluginType::Filter => {
            crate::local_proxy::set_system_prompt_filter_rules(
                app.clone(),
                status.system_prompt_filter_rules,
            )
            .await?;
        }
        PromptPluginType::Injection => {
            crate::local_proxy::set_system_prompt_injection_prompts(
                app.clone(),
                status.system_prompt_injection_prompts,
            )
            .await?;
        }
    }
    write_registry(&app, &registry)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plugin(id: &str, text: &str) -> PromptPluginItem {
        PromptPluginItem {
            id: id.to_string(),
            name: id.to_string(),
            version: "1.0.0".to_string(),
            r#type: PromptPluginType::Injection,
            text: text.to_string(),
            uploader_id: None,
            install_count: 0,
            created_at: String::new(),
            updated_at: String::new(),
            installed: false,
            installed_version: None,
            enabled: true,
        }
    }

    #[test]
    fn install_replaces_only_owned_prompt_and_uninstall_preserves_manual_rule() {
        let mut rules = vec![SystemPromptRule {
            name: "Manual".to_string(),
            text: "Keep me".to_string(),
            enabled: true,
        }];
        let mut registry = PromptPluginRegistry::default();
        apply_installed_prompt_plugin(&mut rules, &mut registry, &plugin("p-1", "Old")).unwrap();
        apply_installed_prompt_plugin(&mut rules, &mut registry, &plugin("p-2", "Other")).unwrap();
        apply_installed_prompt_plugin(&mut rules, &mut registry, &plugin("p-1", "New")).unwrap();
        assert!(rules.iter().any(|rule| rule.text == "Keep me"));
        assert!(rules.iter().any(|rule| rule.text == "Other"));
        assert!(rules.iter().any(|rule| rule.text == "New"));
        remove_installed_prompt_plugin(&mut rules, &mut registry, "p-1");
        assert_eq!(rules.len(), 2);
        assert!(rules.iter().any(|rule| rule.text == "Keep me"));
        assert!(rules.iter().any(|rule| rule.text == "Other"));
    }

    #[test]
    fn toggles_owned_prompt_without_touching_manual_rule() {
        let mut rules = vec![SystemPromptRule {
            name: "Manual".to_string(),
            text: "Manual".to_string(),
            enabled: true,
        }];
        let mut registry = PromptPluginRegistry::default();
        apply_installed_prompt_plugin(&mut rules, &mut registry, &plugin("p-1", "Plugin")).unwrap();
        set_installed_prompt_plugin_enabled(&mut rules, &mut registry, "p-1", false).unwrap();
        assert!(rules
            .iter()
            .any(|rule| rule.text == "Manual" && rule.enabled));
        assert!(rules
            .iter()
            .any(|rule| rule.text == "Plugin" && !rule.enabled));
    }
}
