use std::{
    collections::{BTreeMap, HashMap, HashSet},
    fs,
    io::{Cursor, Read},
    path::{Component, Path, PathBuf},
    time::Duration,
};

use reqwest::{blocking::Client, header};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use url::Url;
use uuid::Uuid;
use zip::ZipArchive;

use crate::dream_skin::state_root;

const API_ORIGIN: &str = "https://api.dreamskin.cc";
const PAGE_SIZE_LIMIT: usize = 48;
const CATALOG_LIMIT: usize = 500;
const JSON_LIMIT: usize = 1024 * 1024;
const METADATA_LIMIT: usize = 64 * 1024;
const PACKAGE_LIMIT: usize = 32 * 1024 * 1024;
const UNPACKED_LIMIT: usize = 64 * 1024 * 1024;
const ARCHIVE_FILE_LIMIT: usize = 32;
const THEME_LIMIT: usize = 1024 * 1024;
const CSS_LIMIT: usize = 256 * 1024;
const IMAGE_LIMIT: usize = 10 * 1024 * 1024;
const TEXT_LIMIT: usize = 64 * 1024;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DreamSkinCommunityTheme {
    pub(crate) apply_compatible: bool,
    pub(crate) author_display_name: String,
    #[serde(default)]
    pub(crate) author_user_id: String,
    #[serde(default)]
    pub(crate) display_meta: Value,
    #[serde(default)]
    pub(crate) download_count: usize,
    pub(crate) id: String,
    pub(crate) license: String,
    pub(crate) name: String,
    pub(crate) package_bytes: usize,
    pub(crate) package_sha256: String,
    #[serde(default)]
    pub(crate) reviewed_at: String,
    #[serde(default)]
    pub(crate) slug: String,
    #[serde(default)]
    pub(crate) submitted_at: String,
    pub(crate) theme_id: String,
    pub(crate) version: String,
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
struct ApiPage {
    items: Vec<DreamSkinCommunityTheme>,
    total: usize,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DreamSkinCommunityPage {
    items: Vec<DreamSkinCommunityTheme>,
    total: usize,
    offset: usize,
    limit: usize,
    cached: bool,
    warning: Option<String>,
}

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct InstallRecords {
    #[serde(default = "schema_version")]
    schema_version: u8,
    #[serde(default)]
    themes: BTreeMap<String, String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PackageManifest {
    package_version: u8,
    theme_id: String,
    version: String,
    skin_api_version: u8,
    min_client_version: String,
    platforms: Vec<String>,
    capabilities: Vec<String>,
    publisher: PackagePublisher,
    license: String,
    provenance: PackageProvenance,
    files: Vec<PackageFile>,
    created_at: String,
    #[serde(default)]
    key_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PackagePublisher {
    id: String,
    display_name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PackageProvenance {
    ai_generated: bool,
    summary: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PackageFile {
    path: String,
    media_type: String,
    bytes: usize,
    sha256: String,
}

struct ValidatedPackage {
    manifest: PackageManifest,
    theme: Value,
    image_bytes: Vec<u8>,
    image_extension: &'static str,
}

pub(crate) fn load_page(offset: usize, limit: usize) -> Result<DreamSkinCommunityPage, String> {
    validate_page_request(offset, limit)?;
    match fetch_page(offset, limit) {
        Ok(mut page) => {
            validate_page(&page, limit)?;
            write_json(&cache_path(offset, limit)?, &page)?;
            enrich(&mut page.items)?;
            Ok(DreamSkinCommunityPage {
                total: page.total.min(CATALOG_LIMIT),
                items: page.items,
                offset,
                limit,
                cached: false,
                warning: None,
            })
        }
        Err(network_error) => {
            let mut page = read_cached_page(offset, limit).map_err(|cache_error| {
                format!("DreamSkin community is unavailable. {network_error} {cache_error}")
            })?;
            enrich(&mut page.items)?;
            Ok(DreamSkinCommunityPage {
                total: page.total.min(CATALOG_LIMIT),
                items: page.items,
                offset,
                limit,
                cached: true,
                warning: Some(
                    "DreamSkin community is temporarily unavailable. Showing the saved page."
                        .to_string(),
                ),
            })
        }
    }
}

pub(crate) fn install(version_id: &str) -> Result<(), String> {
    validate_version_id(version_id)?;
    let metadata_url = api_url(&format!("v1/themes/{version_id}"))?;
    let metadata_bytes = download(&metadata_url, METADATA_LIMIT, "application/json", 30)?;
    let metadata: DreamSkinCommunityTheme = serde_json::from_slice(&metadata_bytes)
        .map_err(|_| "The DreamSkin theme metadata is invalid.".to_string())?;
    validate_theme_metadata(&metadata)?;
    if metadata.id != version_id {
        return Err("The DreamSkin theme version does not match the request.".to_string());
    }
    if !metadata.apply_compatible {
        return Err("This theme is available for online preview only.".to_string());
    }

    let package_url = api_url(&format!("v1/themes/{version_id}/download"))?;
    let package = download(
        &package_url,
        metadata.package_bytes.min(PACKAGE_LIMIT),
        "application/zip",
        120,
    )?;
    if package.len() != metadata.package_bytes {
        return Err(
            "The downloaded theme package size does not match its review record.".to_string(),
        );
    }
    verify_sha256(&package, &metadata.package_sha256, "theme package")?;
    let validated = validate_package(&package)?;
    if validated.manifest.theme_id != metadata.theme_id
        || validated.manifest.version != metadata.version
    {
        return Err("The downloaded theme package does not match its review record.".to_string());
    }

    #[cfg(any(target_os = "windows", target_os = "macos"))]
    crate::dream_skin_native::install_market_theme(
        validated.theme,
        &validated.image_bytes,
        validated.image_extension,
    )?;
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = validated;
        return Err("Community themes are available on Windows and macOS.".to_string());
    }
    record_install(&metadata.theme_id, &metadata.version)
}

fn fetch_page(offset: usize, limit: usize) -> Result<ApiPage, String> {
    let url = api_url(&format!(
        "v1/themes?limit={limit}&offset={offset}&sort=recent"
    ))?;
    let bytes = download(&url, JSON_LIMIT, "application/json", 30)?;
    serde_json::from_slice(&bytes)
        .map_err(|_| "The DreamSkin community response is invalid.".to_string())
}

fn enrich(items: &mut [DreamSkinCommunityTheme]) -> Result<(), String> {
    let records = read_install_records().unwrap_or_default();
    let theme_root = state_root()?.join("themes");
    for item in items {
        item.preview_url = api_url(&format!("v1/themes/{}/preview/thumbnail", item.id))?;
        item.installed = theme_root.join(&item.theme_id).join("theme.json").is_file();
        item.installed_version = records.themes.get(&item.theme_id).cloned();
        item.update_available = item.installed
            && item
                .installed_version
                .as_deref()
                .is_some_and(|version| version != item.version);
    }
    Ok(())
}

fn validate_page_request(offset: usize, limit: usize) -> Result<(), String> {
    if limit == 0 || limit > PAGE_SIZE_LIMIT || offset >= CATALOG_LIMIT {
        Err("The DreamSkin community page request is invalid.".to_string())
    } else {
        Ok(())
    }
}

fn validate_page(page: &ApiPage, requested_limit: usize) -> Result<(), String> {
    if page.items.len() > requested_limit || page.total > usize::MAX / 2 {
        return Err("The DreamSkin community page is invalid.".to_string());
    }
    let mut versions = HashSet::new();
    for item in &page.items {
        validate_theme_metadata(item)?;
        if !versions.insert(item.id.as_str()) {
            return Err("The DreamSkin community page contains duplicate themes.".to_string());
        }
    }
    Ok(())
}

fn validate_theme_metadata(theme: &DreamSkinCommunityTheme) -> Result<(), String> {
    if validate_version_id(&theme.id).is_err()
        || !valid_theme_id(&theme.theme_id)
        || !safe_text(&theme.name, 120)
        || !safe_text(&theme.author_display_name, 120)
        || !safe_text(&theme.license, 80)
        || !valid_semver(&theme.version)
        || theme.package_bytes == 0
        || theme.package_bytes > PACKAGE_LIMIT
        || !valid_sha256(&theme.package_sha256)
    {
        Err(format!(
            "The DreamSkin listing for {} is invalid.",
            theme.id
        ))
    } else {
        Ok(())
    }
}

fn validate_version_id(value: &str) -> Result<(), String> {
    let suffix = value
        .strip_prefix("ver_")
        .ok_or_else(|| "The DreamSkin version id is invalid.".to_string())?;
    if (8..=64).contains(&suffix.len())
        && suffix
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
    {
        Ok(())
    } else {
        Err("The DreamSkin version id is invalid.".to_string())
    }
}
