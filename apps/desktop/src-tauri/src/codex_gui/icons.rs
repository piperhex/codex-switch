use super::error::{GuiError, Result};
use crate::official_plugins::local_icon;
use serde_json::Value;
use std::path::Path;

/// Resolve catalog-provided assets off the UI thread without exposing a file-reading command.
pub(super) async fn resolve(method: &str, data: Value) -> Result<Value> {
    if !matches!(method, "skills/list" | "plugin/installed") {
        return Ok(data);
    }
    let skills = method == "skills/list";
    tauri::async_runtime::spawn_blocking(move || enrich(data, skills))
        .await
        .map_err(|_| GuiError::InvalidRequest)
}

fn enrich(mut data: Value, skills: bool) -> Value {
    let (groups, entries) = if skills {
        ("data", "skills")
    } else {
        ("marketplaces", "plugins")
    };
    let Some(groups) = data.get_mut(groups).and_then(Value::as_array_mut) else {
        return data;
    };
    for entry in groups
        .iter_mut()
        .filter_map(|group| group.get_mut(entries)?.as_array_mut())
        .flatten()
    {
        let icon = if skills {
            skill_icon(entry)
        } else {
            plugin_icon(entry)
        };
        if let (Some(icon), Some(entry)) = (icon, entry.as_object_mut()) {
            entry.insert("iconUrl".into(), Value::String(icon));
        }
    }
    data
}

fn remote_icon(value: &Value) -> Option<String> {
    let value = value.as_str()?;
    let url = url::Url::parse(value).ok()?;
    (url.scheme() == "https" && url.host_str().is_some()).then(|| value.to_owned())
}

fn skill_icon(skill: &Value) -> Option<String> {
    let interface = &skill["interface"];
    remote_icon(&interface["iconSmallUrl"])
        .or_else(|| remote_icon(&interface["iconLargeUrl"]))
        .or_else(|| {
            let directory = Path::new(skill["path"].as_str()?).parent()?;
            // Plugin skills may share assets with sibling skills or their package root.
            let root = directory
                .ancestors()
                .find(|root| root.join(".codex-plugin/plugin.json").is_file())
                .unwrap_or(directory);
            local_icon(root.to_str(), interface["iconSmall"].as_str())
                .or_else(|| local_icon(root.to_str(), interface["iconLarge"].as_str()))
        })
}

fn plugin_icon(plugin: &Value) -> Option<String> {
    let interface = &plugin["interface"];
    remote_icon(&interface["composerIconUrl"])
        .or_else(|| remote_icon(&interface["logoUrl"]))
        .or_else(|| {
            if plugin["source"]["type"] != "local" {
                return None;
            }
            let root = plugin["source"]["path"].as_str();
            local_icon(root, interface["composerIcon"].as_str())
                .or_else(|| local_icon(root, interface["logo"].as_str()))
        })
}

#[cfg(test)]
#[path = "icon_tests.rs"]
mod tests;
