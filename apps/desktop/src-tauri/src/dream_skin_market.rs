use std::{
    collections::{BTreeMap, HashSet},
    fs,
    path::{Component, Path, PathBuf},
    time::Duration,
};

use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use url::Url;
use uuid::Uuid;

use crate::dream_skin::state_root;

const MARKET_INDEX_URL: &str =
    "https://raw.githubusercontent.com/BigPizzaV3/CodexPlusPlus-Themes/main/index.json";
const MARKET_ASSET_ROOT: &str =
    "https://raw.githubusercontent.com/BigPizzaV3/CodexPlusPlus-Themes/main/";
const MARKET_REPOSITORY_URL: &str = "https://github.com/BigPizzaV3/CodexPlusPlus-Themes";
const MARKET_INDEX_LIMIT: usize = 1024 * 1024;
const MARKET_THEME_LIMIT: usize = 256 * 1024;
const MARKET_IMAGE_LIMIT: usize = 16 * 1024 * 1024;
const MARKET_THEME_COUNT_LIMIT: usize = 200;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DreamSkinMarketTheme {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) version: String,
    pub(crate) author: String,
    #[serde(default)]
    pub(crate) description: String,
    pub(crate) license: String,
    #[serde(alias = "source_url")]
    pub(crate) source_url: String,
    #[serde(default)]
    pub(crate) tags: Vec<String>,
    pub(crate) theme: String,
    pub(crate) image: String,
    pub(crate) preview: String,
    #[serde(alias = "theme_sha256")]
    pub(crate) theme_sha256: String,
    #[serde(alias = "image_sha256")]
    pub(crate) image_sha256: String,
    #[serde(default, skip_deserializing)]
    pub(crate) preview_url: String,
    #[serde(default, skip_deserializing)]
    pub(crate) installed: bool,
    #[serde(default, skip_deserializing)]
    pub(crate) installed_version: Option<String>,
    #[serde(default, skip_deserializing)]
    pub(crate) update_available: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct MarketManifest {
    schema_version: u8,
    #[serde(default, alias = "updated_at")]
    updated_at: String,
    themes: Vec<DreamSkinMarketTheme>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DreamSkinMarketResult {
    schema_version: u8,
    updated_at: String,
    repository_url: String,
    cached: bool,
    warning: Option<String>,
    themes: Vec<DreamSkinMarketTheme>,
}

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct InstallRecords {
    #[serde(default = "schema_version")]
    schema_version: u8,
    #[serde(default)]
    themes: BTreeMap<String, String>,
}

pub(crate) fn load() -> Result<DreamSkinMarketResult, String> {
    let (manifest, cached, warning) = match fetch_manifest() {
        Ok(manifest) => {
            write_json(&cache_path()?, &manifest)?;
            (manifest, false, None)
        }
        Err(network_error) => {
            let cached = read_cached_manifest().map_err(|cache_error| {
                format!("The community theme market is unavailable. {network_error} {cache_error}")
            })?;
            (
                cached,
                true,
                Some("The community repository is temporarily unavailable. Showing the most recent local copy.".to_string()),
            )
        }
    };
    enrich(manifest, cached, warning)
}

pub(crate) fn install(theme_id: &str) -> Result<(), String> {
    if !valid_theme_id(theme_id) {
        return Err("Choose a valid community theme.".to_string());
    }
    let result = load()?;
    let theme = result
        .themes
        .iter()
        .find(|theme| theme.id == theme_id)
        .ok_or_else(|| "This theme is no longer available in the community market.".to_string())?;

    let theme_bytes = download(&asset_url(&theme.theme)?, MARKET_THEME_LIMIT)?;
    verify_sha256(&theme_bytes, &theme.theme_sha256, "theme settings")?;
    let document: Value = serde_json::from_slice(&theme_bytes)
        .map_err(|_| "The downloaded theme settings are invalid.".to_string())?;
    if document.get("id").and_then(Value::as_str) != Some(theme.id.as_str())
        || document.get("name").and_then(Value::as_str) != Some(theme.name.as_str())
    {
        return Err("The downloaded theme does not match the market listing.".to_string());
    }

    let image_bytes = download(&asset_url(&theme.image)?, MARKET_IMAGE_LIMIT)?;
    verify_sha256(&image_bytes, &theme.image_sha256, "theme image")?;
    let extension = image_extension(&image_bytes)
        .ok_or_else(|| "The downloaded theme image is not a supported format.".to_string())?;
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    crate::dream_skin_native::install_market_theme(document, &image_bytes, extension)?;
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = (document, image_bytes, extension);
        return Err("Community themes are available on Windows and macOS.".to_string());
    }
    record_install(&theme.id, &theme.version)
}

fn fetch_manifest() -> Result<MarketManifest, String> {
    let bytes = download(MARKET_INDEX_URL, MARKET_INDEX_LIMIT)?;
    let mut manifest: MarketManifest = serde_json::from_slice(&bytes)
        .map_err(|_| "The community theme list is invalid.".to_string())?;
    validate_manifest(&mut manifest)?;
    Ok(manifest)
}

fn enrich(
    mut manifest: MarketManifest,
    cached: bool,
    warning: Option<String>,
) -> Result<DreamSkinMarketResult, String> {
    let installed = read_install_records().unwrap_or_default();
    let themes_root = state_root()?.join("themes");
    for theme in &mut manifest.themes {
        theme.preview_url = asset_url(&theme.preview)?;
        theme.installed = themes_root.join(&theme.id).join("theme.json").is_file();
        theme.installed_version = installed.themes.get(&theme.id).cloned();
        theme.update_available = theme.installed
            && theme
                .installed_version
                .as_deref()
                .is_some_and(|version| version != theme.version);
    }
    Ok(DreamSkinMarketResult {
        schema_version: manifest.schema_version,
        updated_at: manifest.updated_at,
        repository_url: MARKET_REPOSITORY_URL.to_string(),
        cached,
        warning,
        themes: manifest.themes,
    })
}

fn validate_manifest(manifest: &mut MarketManifest) -> Result<(), String> {
    if manifest.schema_version != schema_version() {
        return Err("This community theme list needs a newer app version.".to_string());
    }
    if manifest.themes.len() > MARKET_THEME_COUNT_LIMIT {
        return Err("The community theme list is too large.".to_string());
    }
    let mut ids = HashSet::new();
    for theme in &manifest.themes {
        validate_theme(theme)?;
        if !ids.insert(theme.id.as_str()) {
            return Err("The community theme list contains duplicate entries.".to_string());
        }
    }
    Ok(())
}

fn validate_theme(theme: &DreamSkinMarketTheme) -> Result<(), String> {
    if !valid_theme_id(&theme.id)
        || theme.name.trim().is_empty()
        || theme.name.chars().count() > 120
        || theme.version.trim().is_empty()
        || theme.version.len() > 40
        || theme.author.trim().is_empty()
        || theme.author.chars().count() > 120
        || theme.license.trim().is_empty()
        || theme.license.chars().count() > 120
        || theme.description.chars().count() > 500
        || theme.tags.len() > 12
        || theme
            .tags
            .iter()
            .any(|tag| tag.trim().is_empty() || tag.chars().count() > 32)
    {
        return Err(format!("The listing for {} is invalid.", theme.id));
    }
    let source = Url::parse(&theme.source_url)
        .map_err(|_| format!("The source link for {} is invalid.", theme.name))?;
    if !matches!(source.scheme(), "http" | "https") {
        return Err(format!("The source link for {} is invalid.", theme.name));
    }
    for path in [&theme.theme, &theme.image, &theme.preview] {
        validate_relative_path(path)?;
    }
    validate_sha256(&theme.theme_sha256)?;
    validate_sha256(&theme.image_sha256)
}

fn client() -> Result<Client, String> {
    crate::system_proxy::apply(Client::builder())
        .user_agent(concat!("Codex-Switch/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(8))
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| format!("Could not prepare the theme download: {error}"))
}

fn download(url: &str, limit: usize) -> Result<Vec<u8>, String> {
    let response = client()?
        .get(url)
        .send()
        .map_err(|error| format!("Could not reach the community theme repository: {error}"))?
        .error_for_status()
        .map_err(|error| format!("The community theme repository returned an error: {error}"))?;
    if response
        .content_length()
        .is_some_and(|length| length > limit as u64)
    {
        return Err("The downloaded theme file is too large.".to_string());
    }
    let bytes = response
        .bytes()
        .map_err(|error| format!("The theme download could not be read: {error}"))?;
    if bytes.is_empty() || bytes.len() > limit {
        return Err("The downloaded theme file is empty or too large.".to_string());
    }
    Ok(bytes.to_vec())
}

fn validate_relative_path(value: &str) -> Result<(), String> {
    let path = Path::new(value);
    let valid = !value.is_empty()
        && value.len() <= 256
        && !value.contains(['\\', '?', '#', '\0'])
        && !path.is_absolute()
        && path
            .components()
            .all(|part| matches!(part, Component::Normal(_)))
        && value.split('/').all(|part| {
            !part.is_empty()
                && part
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
        });
    if valid {
        Ok(())
    } else {
        Err("The community theme list contains an unsafe file path.".to_string())
    }
}

fn asset_url(relative: &str) -> Result<String, String> {
    validate_relative_path(relative)?;
    let root = Url::parse(MARKET_ASSET_ROOT).expect("fixed market asset URL is valid");
    let joined = root
        .join(relative)
        .map_err(|_| "The community theme asset link is invalid.".to_string())?;
    if joined.scheme() != root.scheme() || joined.host_str() != root.host_str() {
        return Err("The community theme asset link is invalid.".to_string());
    }
    Ok(joined.to_string())
}

fn valid_theme_id(value: &str) -> bool {
    let bytes = value.as_bytes();
    (1..=80).contains(&bytes.len())
        && bytes[0].is_ascii_alphanumeric()
        && bytes.iter().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'-' | b'_')
        })
}

fn validate_sha256(value: &str) -> Result<(), String> {
    if value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        Ok(())
    } else {
        Err("The community theme list contains an invalid checksum.".to_string())
    }
}

fn verify_sha256(bytes: &[u8], expected: &str, label: &str) -> Result<(), String> {
    validate_sha256(expected)?;
    let actual = format!("{:x}", Sha256::digest(bytes));
    if actual == expected {
        Ok(())
    } else {
        Err(format!(
            "The downloaded {label} failed its integrity check."
        ))
    }
}

fn image_extension(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("png")
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Some("jpg")
    } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("webp")
    } else {
        None
    }
}

fn market_root() -> Result<PathBuf, String> {
    Ok(state_root()?.join("market"))
}

fn cache_path() -> Result<PathBuf, String> {
    Ok(market_root()?.join("index.json"))
}

fn install_records_path() -> Result<PathBuf, String> {
    Ok(market_root()?.join("installed.json"))
}

fn read_cached_manifest() -> Result<MarketManifest, String> {
    let path = cache_path()?;
    let bytes = fs::read(&path)
        .map_err(|_| "No saved community theme list is available yet.".to_string())?;
    if bytes.len() > MARKET_INDEX_LIMIT {
        return Err("The saved community theme list is invalid.".to_string());
    }
    let mut manifest = serde_json::from_slice(&bytes)
        .map_err(|_| "The saved community theme list is invalid.".to_string())?;
    validate_manifest(&mut manifest)?;
    Ok(manifest)
}

fn read_install_records() -> Result<InstallRecords, String> {
    let path = install_records_path()?;
    if !path.is_file() {
        return Ok(InstallRecords {
            schema_version: schema_version(),
            themes: BTreeMap::new(),
        });
    }
    let records: InstallRecords = serde_json::from_slice(
        &fs::read(path).map_err(|error| format!("Could not read installed themes: {error}"))?,
    )
    .map_err(|_| "The installed-theme record is invalid.".to_string())?;
    if records.schema_version != schema_version() {
        return Err("The installed-theme record needs a newer app version.".to_string());
    }
    Ok(records)
}

fn record_install(id: &str, version: &str) -> Result<(), String> {
    let mut records = read_install_records()?;
    records.themes.insert(id.to_string(), version.to_string());
    write_json(&install_records_path()?, &records)
}

fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "The community theme data path is invalid.".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Could not prepare the community theme folder: {error}"))?;
    let temporary = parent.join(format!(".market-{}.tmp", Uuid::new_v4().simple()));
    let bytes = serde_json::to_vec_pretty(value)
        .map_err(|error| format!("Could not save community theme data: {error}"))?;
    fs::write(&temporary, bytes)
        .map_err(|error| format!("Could not save community theme data: {error}"))?;
    if path.is_file() {
        fs::remove_file(path)
            .map_err(|error| format!("Could not update community theme data: {error}"))?;
    }
    fs::rename(&temporary, path)
        .map_err(|error| format!("Could not finish saving community theme data: {error}"))
}

const fn schema_version() -> u8 {
    1
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn market_paths_stay_beneath_the_fixed_repository_root() {
        assert!(validate_relative_path("themes/demo/theme.json").is_ok());
        for invalid in [
            "../theme.json",
            "/theme.json",
            "themes\\demo.png",
            "https://x.test/a",
        ] {
            assert!(
                validate_relative_path(invalid).is_err(),
                "accepted {invalid}"
            );
        }
    }

    #[test]
    fn supported_images_are_detected_from_their_contents() {
        assert_eq!(image_extension(b"\x89PNG\r\n\x1a\nrest"), Some("png"));
        assert_eq!(image_extension(b"\xff\xd8\xffrest"), Some("jpg"));
        assert_eq!(image_extension(b"not an image"), None);
    }
}
