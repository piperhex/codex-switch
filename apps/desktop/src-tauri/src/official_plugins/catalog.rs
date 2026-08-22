use std::{
    collections::HashSet,
    fs,
    path::{Component, Path, PathBuf},
};

use serde::Deserialize;
use toml_edit::DocumentMut;
use url::Url;

use super::{repository, OfficialPluginItem, PluginManifest, OFFICIAL_MARKETPLACES};

const MAX_MANIFEST_BYTES: u64 = 256 * 1024;
const RAW_ASSET_BASE: &str = "https://raw.githubusercontent.com/openai/plugins/main/plugins/";

#[derive(Debug, Deserialize)]
struct Marketplace {
    name: String,
    #[serde(default)]
    plugins: Vec<MarketplacePlugin>,
}

#[derive(Debug, Deserialize)]
struct MarketplacePlugin {
    name: String,
    #[serde(default)]
    category: Option<String>,
}

pub(super) fn list(codex_home: &Path) -> Result<Vec<OfficialPluginItem>, String> {
    let repository = repository::ensure_snapshot(codex_home)?;
    let config = read_config(codex_home)?;
    let mut seen = HashSet::new();
    let mut plugins = Vec::new();
    for marketplace in OFFICIAL_MARKETPLACES {
        let path = repository
            .join(".agents/plugins")
            .join(marketplace_file_name(marketplace));
        let Ok(bytes) = fs::read(&path) else {
            continue;
        };
        let catalog: Marketplace = serde_json::from_slice(&bytes)
            .map_err(|_| "The official plugin catalog could not be read.".to_string())?;
        if catalog.name != *marketplace {
            continue;
        }
        for plugin in catalog.plugins {
            let id = format!("{}@{}", plugin.name, marketplace);
            if !seen.insert(id.clone()) || !is_safe_plugin_name(&plugin.name) {
                continue;
            }
            plugins.push(plugin_item(
                codex_home,
                &repository,
                &config,
                marketplace,
                plugin,
                id,
            ));
        }
    }
    Ok(plugins)
}

fn marketplace_file_name(marketplace: &str) -> &str {
    if marketplace == "openai-api-curated" {
        "api_marketplace.json"
    } else {
        "marketplace.json"
    }
}

fn plugin_item(
    codex_home: &Path,
    repository: &Path,
    config: &str,
    marketplace: &str,
    plugin: MarketplacePlugin,
    id: String,
) -> OfficialPluginItem {
    let root = repository.join("plugins").join(&plugin.name);
    let manifest = read_manifest(&root);
    let author = manifest.author.map(|author| author.name().to_string());
    let interface = manifest.interface.unwrap_or_default();
    let installed = installed_version(codex_home, marketplace, &plugin.name).is_some();
    OfficialPluginItem {
        id,
        title: interface
            .display_name
            .unwrap_or_else(|| fallback_title(&plugin.name)),
        description: interface
            .short_description
            .or(manifest.description)
            .unwrap_or_default(),
        version: manifest.version.unwrap_or_else(|| "local".to_string()),
        category: interface
            .category
            .or(plugin.category)
            .unwrap_or_else(|| "Other".to_string()),
        developer: interface
            .developer_name
            .or(author)
            .unwrap_or_else(|| "OpenAI".to_string()),
        brand_color: valid_brand_color(interface.brand_color),
        icon_url: official_asset_url(
            &plugin.name,
            interface
                .logo
                .as_deref()
                .or(interface.composer_icon.as_deref()),
        ),
        name: plugin.name.clone(),
        installed,
        enabled: installed
            && config_plugin_enabled(config, &format!("{}@{}", plugin.name, marketplace)),
    }
}

fn read_manifest(root: &Path) -> PluginManifest {
    let path = root.join(".codex-plugin/plugin.json");
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

fn installed_version(codex_home: &Path, marketplace: &str, name: &str) -> Option<String> {
    let root = codex_home
        .join("plugins/cache")
        .join(marketplace)
        .join(name);
    let mut versions = fs::read_dir(root)
        .ok()?
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().ok().is_some_and(|kind| kind.is_dir()))
        .filter_map(|entry| entry.file_name().into_string().ok())
        .collect::<Vec<_>>();
    versions.sort();
    versions.pop()
}

fn read_config(codex_home: &Path) -> Result<String, String> {
    match fs::read_to_string(codex_home.join("config.toml")) {
        Ok(config) => Ok(config),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(_) => Err("The Codex plugin setting could not be read. Please try again.".to_string()),
    }
}

pub(super) fn config_plugin_enabled(config: &str, plugin_id: &str) -> bool {
    config
        .parse::<DocumentMut>()
        .ok()
        .and_then(|document| document["plugins"][plugin_id]["enabled"].as_bool())
        .unwrap_or(true)
}

fn fallback_title(name: &str) -> String {
    name.split('-')
        .filter(|part| !part.is_empty())
        .map(|part| {
            let mut chars = part.chars();
            chars
                .next()
                .map(|first| first.to_uppercase().chain(chars).collect())
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

pub(super) fn official_asset_url(plugin_name: &str, asset: Option<&str>) -> Option<String> {
    let asset = safe_asset_path(asset?)?;
    let base = Url::parse(RAW_ASSET_BASE).ok()?;
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

pub(super) fn validate_plugin_id(plugin_id: &str) -> Option<(&str, &str)> {
    let (name, marketplace) = plugin_id.split_once('@')?;
    let valid_name = is_safe_plugin_name(name);
    (valid_name && OFFICIAL_MARKETPLACES.contains(&marketplace)).then_some((name, marketplace))
}

fn is_safe_plugin_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 128
        && name
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
}

pub(super) fn plugin_source(repository: &Path, name: &str) -> PathBuf {
    repository.join("plugins").join(name)
}

pub(super) fn contains_plugin(repository: &Path, marketplace: &str, name: &str) -> bool {
    let path = repository
        .join(".agents/plugins")
        .join(marketplace_file_name(marketplace));
    fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Marketplace>(&bytes).ok())
        .filter(|catalog| catalog.name == marketplace)
        .is_some_and(|catalog| catalog.plugins.iter().any(|plugin| plugin.name == name))
}
