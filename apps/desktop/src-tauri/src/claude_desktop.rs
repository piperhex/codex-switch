use std::{
    env, fs,
    path::{Path, PathBuf},
};

use serde_json::{json, Value};

use crate::storage::{read_json, write_json_atomic};

const CONFIG_FILE: &str = "claude_desktop_config.json";
const PROFILE_ID: &str = "00000000-0000-4000-8000-000000157210";
const PROFILE_NAME: &str = "Codex Switch";
const PROXY_TOKEN: &str = "PROXY_MANAGED";
const PROXY_ROUTE: &str = "/claude-desktop";

pub(crate) fn write_official_proxy_settings() -> Result<(), String> {
    sync_desktop_paths(false)
}

pub(crate) fn clear_proxy_settings() -> Result<(), String> {
    sync_desktop_paths(true)
}

fn sync_desktop_paths(clear: bool) -> Result<(), String> {
    let mut errors = Vec::new();
    for root in desktop_config_roots() {
        let result = if clear {
            clear_at_root(&root)
        } else {
            write_at_root(&root)
        };
        if let Err(error) = result {
            errors.push(format!("{}：{error}", root.display()));
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("；"))
    }
}

fn desktop_config_roots() -> Vec<PathBuf> {
    let local_app_data = env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .or_else(|| dirs::home_dir().map(|home| home.join("AppData").join("Local")));
    let Some(local_app_data) = local_app_data else {
        return Vec::new();
    };
    let mut roots = Vec::new();
    for name in ["Claude", "Claude-3p"] {
        let path = local_app_data.join(name);
        if path.is_dir() {
            roots.push(path);
        }
    }
    if let Ok(entries) = fs::read_dir(&local_app_data) {
        for entry in entries.flatten() {
            let path = entry.path();
            let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
                continue;
            };
            if !name.starts_with("Claude_") || !path.is_dir() {
                continue;
            }
            let package_root = path.join("LocalCache").join("Roaming").join("Claude");
            if package_root.is_dir() {
                roots.push(package_root);
            }
        }
    }
    roots.sort();
    roots.dedup();
    roots
}

fn write_at_root(root: &Path) -> Result<(), String> {
    let config_path = root.join(CONFIG_FILE);
    let profile_path = root
        .join("configLibrary")
        .join(format!("{PROFILE_ID}.json"));
    let meta_path = root.join("configLibrary").join("_meta.json");
    update_deployment_mode(&config_path, "3p")?;
    write_json_atomic(&profile_path, &gateway_profile())?;
    update_meta(&meta_path, true)
}

fn clear_at_root(root: &Path) -> Result<(), String> {
    let config_path = root.join(CONFIG_FILE);
    let profile_path = root
        .join("configLibrary")
        .join(format!("{PROFILE_ID}.json"));
    let meta_path = root.join("configLibrary").join("_meta.json");
    if !config_path.exists() && !profile_path.exists() && !meta_path.exists() {
        return Ok(());
    }
    update_deployment_mode(&config_path, "1p")?;
    if profile_path.exists() {
        fs::remove_file(&profile_path).map_err(|error| format!("删除托管配置失败：{error}"))?;
    }
    update_meta(&meta_path, false)
}

fn update_deployment_mode(path: &Path, mode: &str) -> Result<(), String> {
    let mut value = read_object_or_empty(path)?;
    value["deploymentMode"] = Value::String(mode.to_string());
    write_json_atomic(path, &value)
}

fn update_meta(path: &Path, enabled: bool) -> Result<(), String> {
    let mut value = read_object_or_empty(path)?;
    let object = value
        .as_object_mut()
        .ok_or_else(|| "Claude Desktop _meta.json 必须是 JSON 对象".to_string())?;
    let entries = object
        .entry("entries")
        .or_insert_with(|| Value::Array(Vec::new()))
        .as_array_mut()
        .ok_or_else(|| "Claude Desktop _meta.json 的 entries 必须是数组".to_string())?;
    entries.retain(|entry| entry.get("id").and_then(Value::as_str) != Some(PROFILE_ID));
    if enabled {
        entries.push(json!({ "id": PROFILE_ID, "name": PROFILE_NAME }));
        object.insert(
            "appliedId".to_string(),
            Value::String(PROFILE_ID.to_string()),
        );
    } else if object.get("appliedId").and_then(Value::as_str) == Some(PROFILE_ID) {
        object.remove("appliedId");
    }
    write_json_atomic(path, &value)
}

fn read_object_or_empty(path: &Path) -> Result<Value, String> {
    if !path.exists() {
        return Ok(json!({}));
    }
    let value = read_json(path)?;
    if value.is_object() {
        Ok(value)
    } else {
        Err(format!("{} 必须是 JSON 对象", path.display()))
    }
}

fn gateway_profile() -> Value {
    json!({
        "coworkEgressAllowedHosts": ["*"],
        "disableDeploymentModeChooser": true,
        "inferenceGatewayApiKey": PROXY_TOKEN,
        "inferenceGatewayAuthScheme": "bearer",
        "inferenceGatewayBaseUrl": format!("http://127.0.0.1:15722{PROXY_ROUTE}"),
        "inferenceProvider": "gateway",
        "inferenceModels": [
            { "name": "claude-haiku-4-5" },
            { "name": "claude-sonnet-5", "supports1m": true },
            { "name": "claude-opus-5", "supports1m": true }
        ]
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn desktop_gateway_profile_uses_the_local_proxy_route() {
        let profile = gateway_profile();
        assert_eq!(
            profile["inferenceGatewayBaseUrl"],
            "http://127.0.0.1:15722/claude-desktop"
        );
        assert_eq!(profile["inferenceGatewayAuthScheme"], "bearer");
        assert_eq!(profile["inferenceGatewayApiKey"], "PROXY_MANAGED");
    }
}
