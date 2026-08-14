use std::{
    collections::HashSet,
    fs,
    path::{Component, Path, PathBuf},
    process::{Command, Output},
};

use serde::{Deserialize, Serialize};
use url::Url;

const OFFICIAL_MARKETPLACE: &str = "openai-curated";
const MAX_MANIFEST_BYTES: u64 = 256 * 1024;
const OFFICIAL_PLUGIN_RAW_BASE: &str =
    "https://raw.githubusercontent.com/openai/plugins/main/plugins/";

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OfficialPluginItem {
    id: String,
    name: String,
    title: String,
    description: String,
    version: String,
    category: String,
    developer: String,
    brand_color: Option<String>,
    icon_url: Option<String>,
    installed: bool,
    enabled: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CliPluginList {
    #[serde(default)]
    installed: Vec<CliPlugin>,
    #[serde(default)]
    available: Vec<CliPlugin>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CliPlugin {
    plugin_id: String,
    name: String,
    marketplace_name: String,
    version: Option<String>,
    #[serde(default)]
    installed: bool,
    #[serde(default)]
    enabled: bool,
    source: CliPluginSource,
    install_policy: String,
}

#[derive(Debug, Clone, Deserialize)]
struct CliPluginSource {
    source: String,
    path: Option<PathBuf>,
}

#[derive(Debug, Default, Deserialize)]
struct PluginManifest {
    version: Option<String>,
    description: Option<String>,
    author: Option<ManifestAuthor>,
    interface: Option<PluginInterface>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum ManifestAuthor {
    Name(String),
    Detail { name: String },
}

impl ManifestAuthor {
    fn name(&self) -> &str {
        match self {
            Self::Name(name) | Self::Detail { name } => name,
        }
    }
}

#[derive(Debug, Default, Deserialize)]
struct PluginInterface {
    #[serde(rename = "displayName")]
    display_name: Option<String>,
    #[serde(rename = "shortDescription")]
    short_description: Option<String>,
    #[serde(rename = "developerName")]
    developer_name: Option<String>,
    category: Option<String>,
    #[serde(rename = "brandColor")]
    brand_color: Option<String>,
    logo: Option<String>,
    #[serde(rename = "composerIcon")]
    composer_icon: Option<String>,
}

fn codex_command() -> Command {
    let mut command = Command::new("codex");
    command.env("NO_COLOR", "1");
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

fn run_codex(args: &[&str], failure_message: &str) -> Result<Output, String> {
    let output = codex_command().args(args).output().map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            return "Codex plugins are unavailable. Install or update the official Codex app, then try again."
                .to_string();
        }
        failure_message.to_string()
    })?;
    if output.status.success() {
        Ok(output)
    } else {
        Err(failure_message.to_string())
    }
}

fn read_manifest(plugin: &CliPlugin) -> PluginManifest {
    if !plugin.source.source.eq_ignore_ascii_case("local") {
        return PluginManifest::default();
    }
    let Some(root) = plugin.source.path.as_deref() else {
        return PluginManifest::default();
    };
    let path = root.join(".codex-plugin").join("plugin.json");
    let Ok(metadata) = fs::metadata(&path) else {
        return PluginManifest::default();
    };
    if !metadata.is_file() || metadata.len() > MAX_MANIFEST_BYTES {
        return PluginManifest::default();
    }
    fs::read(path)
        .ok()
        .and_then(|data| serde_json::from_slice(&data).ok())
        .unwrap_or_default()
}

fn fallback_title(name: &str) -> String {
    name.split('-')
        .filter(|part| !part.is_empty())
        .map(|part| {
            let mut characters = part.chars();
            characters
                .next()
                .map(|first| first.to_uppercase().chain(characters).collect())
                .unwrap_or_default()
        })
        .collect::<Vec<String>>()
        .join(" ")
}

fn safe_asset_path(value: &str) -> Option<String> {
    let path = Path::new(value);
    if path.is_absolute() || value.contains('\\') {
        return None;
    }
    let parts = path
        .components()
        .filter_map(|component| match component {
            Component::Normal(part) => part.to_str(),
            Component::CurDir => None,
            _ => Some(""),
        })
        .collect::<Vec<_>>();
    if parts.is_empty() || parts.iter().any(|part| part.is_empty()) {
        return None;
    }
    Some(parts.join("/"))
}

fn official_asset_url(plugin_name: &str, asset: Option<&str>) -> Option<String> {
    let asset = safe_asset_path(asset?)?;
    let base = Url::parse(OFFICIAL_PLUGIN_RAW_BASE).ok()?;
    base.join(&format!("{plugin_name}/{asset}"))
        .ok()
        .map(|url| url.to_string())
}

fn valid_brand_color(value: Option<String>) -> Option<String> {
    value.filter(|color| {
        color.len() == 7
            && color.starts_with('#')
            && color[1..]
                .chars()
                .all(|character| character.is_ascii_hexdigit())
    })
}

fn plugin_item(plugin: CliPlugin) -> OfficialPluginItem {
    let manifest = read_manifest(&plugin);
    let interface = manifest.interface.unwrap_or_default();
    let icon = interface
        .logo
        .as_deref()
        .or(interface.composer_icon.as_deref());
    OfficialPluginItem {
        id: plugin.plugin_id,
        title: interface
            .display_name
            .unwrap_or_else(|| fallback_title(&plugin.name)),
        description: interface
            .short_description
            .or(manifest.description)
            .unwrap_or_default(),
        version: plugin
            .version
            .or(manifest.version)
            .unwrap_or_else(|| "0.0.0".to_string()),
        category: interface.category.unwrap_or_else(|| "Other".to_string()),
        developer: interface
            .developer_name
            .or_else(|| manifest.author.map(|author| author.name().to_string()))
            .unwrap_or_else(|| "OpenAI".to_string()),
        brand_color: valid_brand_color(interface.brand_color),
        icon_url: official_asset_url(&plugin.name, icon),
        name: plugin.name,
        installed: plugin.installed,
        enabled: plugin.enabled,
    }
}

fn is_official_available(plugin: &CliPlugin) -> bool {
    plugin.marketplace_name == OFFICIAL_MARKETPLACE
        && (plugin.installed || plugin.install_policy == "AVAILABLE")
}

fn parse_official_plugins(data: &[u8]) -> Result<Vec<OfficialPluginItem>, String> {
    let response: CliPluginList = serde_json::from_slice(data).map_err(|_| {
        "The official plugin catalog could not be read. Update Codex and try again.".to_string()
    })?;
    let mut seen = HashSet::new();
    Ok(response
        .installed
        .into_iter()
        .chain(response.available)
        .filter(is_official_available)
        .filter(|plugin| seen.insert(plugin.plugin_id.clone()))
        .map(plugin_item)
        .collect())
}

fn list_official_plugins_blocking() -> Result<Vec<OfficialPluginItem>, String> {
    let output = run_codex(
        &["plugin", "list", "--available", "--json"],
        "Could not load the official plugin catalog. Update Codex and try again.",
    )?;
    parse_official_plugins(&output.stdout)
}

fn official_plugin_name(plugin_id: &str) -> Option<&str> {
    let (name, marketplace) = plugin_id.split_once('@')?;
    let valid_name = !name.is_empty()
        && name.len() <= 128
        && name
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'));
    (valid_name && marketplace == OFFICIAL_MARKETPLACE).then_some(name)
}

fn install_official_plugin_blocking(plugin_id: &str) -> Result<(), String> {
    let name = official_plugin_name(plugin_id).ok_or_else(|| {
        "This official plugin selection is invalid. Refresh the catalog and try again.".to_string()
    })?;
    run_codex(
        &[
            "plugin",
            "add",
            name,
            "--marketplace",
            OFFICIAL_MARKETPLACE,
            "--json",
        ],
        "The official plugin could not be installed. Update Codex and try again.",
    )?;
    Ok(())
}

#[tauri::command]
pub(crate) async fn list_official_plugins() -> Result<Vec<OfficialPluginItem>, String> {
    tauri::async_runtime::spawn_blocking(list_official_plugins_blocking)
        .await
        .map_err(|_| "The official plugin catalog stopped loading. Please try again.".to_string())?
}

#[tauri::command]
pub(crate) async fn install_official_plugin(plugin_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || install_official_plugin_blocking(&plugin_id))
        .await
        .map_err(|_| "The official plugin installation stopped. Please try again.".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_official_plugin_ids() {
        assert_eq!(
            official_plugin_name("build-web-apps@openai-curated"),
            Some("build-web-apps")
        );
        assert_eq!(official_plugin_name("demo@community"), None);
        assert_eq!(official_plugin_name("../demo@openai-curated"), None);
    }

    #[test]
    fn builds_only_safe_official_asset_urls() {
        assert_eq!(
            official_asset_url("linear", Some("./assets/icon.svg")),
            Some(
                "https://raw.githubusercontent.com/openai/plugins/main/plugins/linear/assets/icon.svg"
                    .to_string()
            )
        );
        assert_eq!(official_asset_url("linear", Some("../secret")), None);
        assert_eq!(official_asset_url("linear", Some("C:\\secret")), None);
    }

    #[test]
    fn filters_non_official_marketplaces() {
        let data = br#"{
          "installed": [],
          "available": [
            {
              "pluginId": "linear@openai-curated",
              "name": "linear",
              "marketplaceName": "openai-curated",
              "version": "1.0.0",
              "installed": false,
              "enabled": false,
              "source": { "source": "git" },
              "installPolicy": "AVAILABLE"
            },
            {
              "pluginId": "demo@community",
              "name": "demo",
              "marketplaceName": "community",
              "version": "1.0.0",
              "installed": false,
              "enabled": false,
              "source": { "source": "git" },
              "installPolicy": "AVAILABLE"
            }
          ]
        }"#;
        let items = parse_official_plugins(data).expect("catalog should parse");
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].id, "linear@openai-curated");
    }
}
