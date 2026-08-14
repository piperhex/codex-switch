use std::{
    collections::HashSet,
    fs,
    path::{Component, Path, PathBuf},
    process::{Command, Output},
};

use serde::{Deserialize, Serialize};
use toml_edit::{value, DocumentMut};
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

fn codex_command(executable: &Path) -> Command {
    let mut command = Command::new(executable);
    command.env("NO_COLOR", "1");
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

fn execute_codex(executable: &Path, args: &[&str]) -> std::io::Result<Output> {
    codex_command(executable).args(args).output()
}

#[cfg(target_os = "windows")]
fn execute_official_codex(args: &[&str]) -> Option<std::io::Result<Output>> {
    crate::dream_skin_native::find_codex_cli_executable()
        .map(|executable| execute_codex(&executable, args))
}

#[cfg(not(target_os = "windows"))]
fn execute_official_codex(_args: &[&str]) -> Option<std::io::Result<Output>> {
    None
}

fn run_codex(args: &[&str], failure_message: &str) -> Result<Output, String> {
    let output = match execute_official_codex(args) {
        Some(Ok(output)) => Ok(output),
        Some(Err(error))
            if matches!(
                error.kind(),
                std::io::ErrorKind::NotFound | std::io::ErrorKind::PermissionDenied
            ) =>
        {
            execute_codex(Path::new("codex"), args)
        }
        Some(Err(error)) => Err(error),
        None => execute_codex(Path::new("codex"), args),
    }
    .map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            return "Codex plugin support is unavailable. Update Codex, restart Codex Switch, and try again."
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

fn remove_official_plugin_blocking(plugin_id: &str) -> Result<(), String> {
    let name = official_plugin_name(plugin_id).ok_or_else(|| {
        "This official plugin selection is invalid. Refresh the catalog and try again.".to_string()
    })?;
    run_codex(
        &[
            "plugin",
            "remove",
            name,
            "--marketplace",
            OFFICIAL_MARKETPLACE,
            "--json",
        ],
        "The official plugin could not be uninstalled. Update Codex and try again.",
    )?;
    Ok(())
}

fn update_plugin_enabled_text(
    config: &str,
    plugin_id: &str,
    enabled: bool,
) -> Result<String, String> {
    let mut document = config.parse::<DocumentMut>().map_err(|_| {
        "The Codex plugin setting could not be read. Check your Codex settings and try again."
            .to_string()
    })?;
    document["plugins"][plugin_id]["enabled"] = value(enabled);
    Ok(document.to_string())
}

fn set_official_plugin_enabled_blocking(
    app: &tauri::AppHandle,
    plugin_id: &str,
    enabled: bool,
) -> Result<(), String> {
    official_plugin_name(plugin_id).ok_or_else(|| {
        "This official plugin selection is invalid. Refresh the catalog and try again.".to_string()
    })?;
    let paths = crate::storage::resolve_paths(app)?;
    let current = match fs::read_to_string(&paths.current_config) {
        Ok(config) => config,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(_) => {
            return Err("The Codex plugin setting could not be read. Please try again.".to_string())
        }
    };
    let updated = update_plugin_enabled_text(&current, plugin_id, enabled)?;
    crate::storage::write_text_atomic(&paths.current_config, &updated)
        .map_err(|_| "The Codex plugin setting could not be saved. Please try again.".to_string())
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

#[tauri::command]
pub(crate) async fn remove_official_plugin(plugin_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || remove_official_plugin_blocking(&plugin_id))
        .await
        .map_err(|_| "The official plugin uninstall stopped. Please try again.".to_string())?
}

#[tauri::command]
pub(crate) async fn set_official_plugin_enabled(
    app: tauri::AppHandle,
    plugin_id: String,
    enabled: bool,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        set_official_plugin_enabled_blocking(&app, &plugin_id, enabled)
    })
    .await
    .map_err(|_| "The official plugin setting stopped updating. Please try again.".to_string())?
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

    #[test]
    fn updates_only_the_selected_plugin_state() {
        let config = r#"model = "gpt-5"

[plugins."gmail@openai-curated"]
enabled = true

[plugins."browser@openai-bundled"]
enabled = true
"#;
        let updated = update_plugin_enabled_text(config, "gmail@openai-curated", false).unwrap();
        let document = updated.parse::<DocumentMut>().unwrap();

        assert_eq!(document["model"].as_str(), Some("gpt-5"));
        assert_eq!(
            document["plugins"]["gmail@openai-curated"]["enabled"].as_bool(),
            Some(false)
        );
        assert_eq!(
            document["plugins"]["browser@openai-bundled"]["enabled"].as_bool(),
            Some(true)
        );
    }

    #[test]
    fn creates_plugin_state_in_an_empty_config() {
        let updated = update_plugin_enabled_text("", "gmail@openai-curated", true).unwrap();
        let document = updated.parse::<DocumentMut>().unwrap();

        assert_eq!(
            document["plugins"]["gmail@openai-curated"]["enabled"].as_bool(),
            Some(true)
        );
    }
}
