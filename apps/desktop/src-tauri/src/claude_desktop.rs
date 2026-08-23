use std::{
    fs,
    path::{Path, PathBuf},
};

#[cfg(not(target_os = "macos"))]
use std::env;

use serde_json::{json, Value};

use crate::storage::{read_json, write_json_atomic};

const CONFIG_FILE: &str = "claude_desktop_config.json";
const PROFILE_ID: &str = "00000000-0000-4000-8000-000000157210";
const PROFILE_NAME: &str = "Codex Switch";
const PROXY_TOKEN: &str = "PROXY_MANAGED";
const PROXY_ROUTE: &str = "/claude-desktop";

pub(crate) fn write_official_proxy_settings(context_window: u64) -> Result<(), String> {
    sync_desktop_paths(false, context_window)
}

pub(crate) fn clear_proxy_settings() -> Result<(), String> {
    sync_desktop_paths(true, 0)
}

fn sync_desktop_paths(clear: bool, context_window: u64) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        sync_macos_paths(clear, context_window)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let mut errors = Vec::new();
        for root in desktop_config_roots() {
            let result = if clear {
                clear_at_root(&root)
            } else {
                write_at_root(&root, context_window)
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
}

#[cfg(not(target_os = "macos"))]
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
    append_store_package_roots(&mut roots, &local_app_data);
    append_store_package_roots(&mut roots, &local_app_data.join("Packages"));
    roots.sort();
    roots.dedup();
    roots
}

#[cfg(not(target_os = "macos"))]
fn append_store_package_roots(roots: &mut Vec<PathBuf>, parent: &Path) {
    let Ok(entries) = fs::read_dir(parent) else {
        return;
    };
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

#[cfg(target_os = "macos")]
fn sync_macos_paths(clear: bool, context_window: u64) -> Result<(), String> {
    let home = dirs::home_dir().ok_or_else(|| "无法定位用户主目录".to_string())?;
    let (normal_root, threep_root) = macos_config_roots(&home);
    if clear {
        if normal_root.join(CONFIG_FILE).exists() {
            update_deployment_mode(&normal_root.join(CONFIG_FILE), "1p")?;
        }
        return clear_at_root(&threep_root);
    }
    update_deployment_mode(&normal_root.join(CONFIG_FILE), "3p")?;
    write_at_root(&threep_root, context_window)
}

#[cfg(any(target_os = "macos", test))]
fn macos_config_roots(home: &Path) -> (PathBuf, PathBuf) {
    let application_support = home.join("Library").join("Application Support");
    (
        application_support.join("Claude"),
        application_support.join("Claude-3p"),
    )
}

fn write_at_root(root: &Path, context_window: u64) -> Result<(), String> {
    let config_path = root.join(CONFIG_FILE);
    let profile_path = root
        .join("configLibrary")
        .join(format!("{PROFILE_ID}.json"));
    let meta_path = root.join("configLibrary").join("_meta.json");
    update_deployment_mode(&config_path, "3p")?;
    write_json_atomic(&profile_path, &gateway_profile(context_window))?;
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

fn gateway_profile(context_window: u64) -> Value {
    let supports_1m = context_window >= 1_000_000;
    let model = |name: &str, label: &str| {
        let mut value = json!({ "name": name, "labelOverride": label });
        if supports_1m {
            value["supports1m"] = Value::Bool(true);
        }
        value
    };
    json!({
        "coworkEgressAllowedHosts": ["*"],
        "disableDeploymentModeChooser": true,
        "inferenceGatewayApiKey": PROXY_TOKEN,
        "inferenceGatewayAuthScheme": "bearer",
        "inferenceGatewayBaseUrl": format!("http://127.0.0.1:15722{PROXY_ROUTE}"),
        "inferenceProvider": "gateway",
        "inferenceModels": [
            model("claude-haiku-4-5", "gpt-5.6-luna"),
            model("claude-sonnet-5", "gpt-5.6-sol"),
            model("claude-opus-5", "gpt-5.6-sol")
        ]
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn desktop_gateway_profile_uses_the_local_proxy_route() {
        let profile = gateway_profile(1_000_000);
        assert_eq!(
            profile["inferenceGatewayBaseUrl"],
            "http://127.0.0.1:15722/claude-desktop"
        );
        assert_eq!(profile["inferenceGatewayAuthScheme"], "bearer");
        assert_eq!(profile["inferenceGatewayApiKey"], "PROXY_MANAGED");
        assert_eq!(
            profile["inferenceModels"][1]["labelOverride"],
            "gpt-5.6-sol"
        );
        assert!(profile["inferenceModels"]
            .as_array()
            .expect("models")
            .iter()
            .all(|model| model.get("supports1m") == Some(&Value::Bool(true))));
        let compact_profile = gateway_profile(272_000);
        assert!(compact_profile["inferenceModels"]
            .as_array()
            .expect("models")
            .iter()
            .all(|model| model.get("supports1m").is_none()));
    }

    #[test]
    fn macos_roots_match_claude_physical_directories() {
        let home = PathBuf::from("/Users/tester");
        let (normal, threep) = macos_config_roots(&home);
        assert_eq!(
            normal,
            home.join("Library")
                .join("Application Support")
                .join("Claude")
        );
        assert_eq!(
            threep,
            home.join("Library")
                .join("Application Support")
                .join("Claude-3p")
        );
    }
}
