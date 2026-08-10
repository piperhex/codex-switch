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

fn validate_package(bytes: &[u8]) -> Result<ValidatedPackage, String> {
    if bytes.is_empty() || bytes.len() > PACKAGE_LIMIT {
        return Err("The DreamSkin theme package exceeds 32 MB.".to_string());
    }
    let mut archive = ZipArchive::new(Cursor::new(bytes))
        .map_err(|_| "The DreamSkin theme package is not a valid ZIP file.".to_string())?;
    if archive.is_empty() || archive.len() > ARCHIVE_FILE_LIMIT {
        return Err("The DreamSkin theme package contains too many files.".to_string());
    }

    let mut files = HashMap::<String, Vec<u8>>::new();
    let mut root: Option<String> = None;
    let mut saw_root_file = false;
    let mut unpacked = 0usize;
    for index in 0..archive.len() {
        let file = archive
            .by_index(index)
            .map_err(|_| "A DreamSkin package entry could not be read.".to_string())?;
        if file.is_dir() {
            continue;
        }
        if file.encrypted()
            || file
                .unix_mode()
                .is_some_and(|mode| mode & 0o170000 == 0o120000)
        {
            return Err("The DreamSkin package contains a link or encrypted file.".to_string());
        }
        let enclosed = file
            .enclosed_name()
            .ok_or_else(|| "The DreamSkin package contains an unsafe path.".to_string())?;
        if enclosed
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
        {
            return Err("The DreamSkin package contains an unsafe path.".to_string());
        }
        let parts = enclosed
            .iter()
            .map(|part| part.to_string_lossy().into_owned())
            .collect::<Vec<_>>();
        if parts.last().is_some_and(|name| name == ".DS_Store")
            || parts.first().is_some_and(|name| name == "__MACOSX")
        {
            continue;
        }
        let name = match parts.as_slice() {
            [name] => {
                if root.is_some() {
                    return Err("DreamSkin package files must share one root folder.".to_string());
                }
                saw_root_file = true;
                name.clone()
            }
            [folder, name] => {
                if saw_root_file || root.as_deref().is_some_and(|current| current != folder) {
                    return Err("DreamSkin package files must share one root folder.".to_string());
                }
                root.get_or_insert_with(|| folder.clone());
                name.clone()
            }
            _ => return Err("The DreamSkin package contains nested folders.".to_string()),
        };
        let limit = package_file_limit(&name)?;
        let mut content = Vec::new();
        file.take((limit + 1) as u64)
            .read_to_end(&mut content)
            .map_err(|_| "A DreamSkin package file could not be read.".to_string())?;
        if content.is_empty() || content.len() > limit {
            return Err(format!("The DreamSkin package file {name} is too large."));
        }
        unpacked = unpacked.saturating_add(content.len());
        if unpacked > UNPACKED_LIMIT || files.insert(name.clone(), content).is_some() {
            return Err(
                "The DreamSkin package is too large or contains duplicate files.".to_string(),
            );
        }
    }

    let manifest_bytes = files
        .remove("manifest.json")
        .ok_or_else(|| "The DreamSkin package is missing manifest.json.".to_string())?;
    let theme_bytes = files
        .remove("theme.json")
        .ok_or_else(|| "The DreamSkin package is missing theme.json.".to_string())?;
    let css_bytes = files
        .remove("theme.css")
        .ok_or_else(|| "The DreamSkin package is missing theme.css.".to_string())?;
    std::str::from_utf8(&css_bytes)
        .map_err(|_| "The DreamSkin theme stylesheet is invalid.".to_string())?;
    let image_names = ["background.png", "background.jpg", "background.webp"];
    let present_images = image_names
        .iter()
        .filter(|name| files.contains_key(**name))
        .copied()
        .collect::<Vec<_>>();
    if present_images.len() != 1 {
        return Err("The DreamSkin package must contain exactly one background image.".to_string());
    }
    let image_name = present_images[0];
    let image_bytes = files.remove(image_name).expect("image was checked");
    let image_extension = image_extension(&image_bytes)
        .filter(|extension| *extension == image_name.trim_start_matches("background."))
        .ok_or_else(|| {
            "The DreamSkin background image format does not match its name.".to_string()
        })?;
    let license_bytes = files.remove("LICENSE.txt");
    let _signature = files.remove("manifest.sig");
    if !files.is_empty() {
        return Err("The DreamSkin package contains unsupported files.".to_string());
    }

    let manifest: PackageManifest = serde_json::from_slice(&manifest_bytes)
        .map_err(|_| "The DreamSkin package manifest is invalid.".to_string())?;
    validate_package_manifest(&manifest)?;
    let theme: Value = serde_json::from_slice(&theme_bytes)
        .map_err(|_| "The DreamSkin theme settings are invalid.".to_string())?;
    if theme.get("schemaVersion").and_then(Value::as_u64) != Some(1)
        || theme.get("id").and_then(Value::as_str) != Some(manifest.theme_id.as_str())
        || theme.get("name").and_then(Value::as_str).is_none()
        || theme.get("image").and_then(Value::as_str) != Some(image_name)
    {
        return Err("The DreamSkin theme settings do not match the package manifest.".to_string());
    }
    validate_manifest_files(
        &manifest,
        &theme_bytes,
        &css_bytes,
        image_name,
        &image_bytes,
        license_bytes.as_deref(),
    )?;
    Ok(ValidatedPackage {
        manifest,
        theme,
        image_bytes,
        image_extension,
    })
}

fn validate_package_manifest(manifest: &PackageManifest) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    let platform = "windows";
    #[cfg(target_os = "macos")]
    let platform = "macos";
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let platform = std::env::consts::OS;

    let _metadata_is_present = (
        &manifest.publisher.id,
        &manifest.publisher.display_name,
        manifest.provenance.ai_generated,
        &manifest.provenance.summary,
        &manifest.created_at,
        &manifest.key_id,
    );
    if manifest.package_version != 1
        || manifest.skin_api_version != 1
        || !valid_theme_id(&manifest.theme_id)
        || !valid_semver(&manifest.version)
        || !valid_semver(&manifest.min_client_version)
        || !manifest.platforms.iter().any(|value| value == platform)
        || !manifest
            .capabilities
            .iter()
            .any(|value| value == "background")
        || manifest.license.trim().is_empty()
        || manifest.files.len() < 3
        || manifest.files.len() > 8
    {
        return Err("The DreamSkin package manifest is not compatible with this app.".to_string());
    }
    Ok(())
}

fn validate_manifest_files(
    manifest: &PackageManifest,
    theme_bytes: &[u8],
    css_bytes: &[u8],
    image_name: &str,
    image_bytes: &[u8],
    license_bytes: Option<&[u8]>,
) -> Result<(), String> {
    let mut seen = HashSet::new();
    for file in &manifest.files {
        if !seen.insert(file.path.as_str())
            || matches!(file.path.as_str(), "manifest.json" | "manifest.sig")
            || !valid_sha256(&file.sha256)
        {
            return Err(
                "The DreamSkin package manifest contains an invalid file entry.".to_string(),
            );
        }
        let (bytes, media_type) = match file.path.as_str() {
            "theme.json" => (theme_bytes, "application/json"),
            "theme.css" => (css_bytes, "text/css"),
            path if path == image_name => (
                image_bytes,
                match image_name {
                    "background.png" => "image/png",
                    "background.jpg" => "image/jpeg",
                    _ => "image/webp",
                },
            ),
            "LICENSE.txt" => (
                license_bytes.ok_or_else(|| {
                    "The DreamSkin package is missing its declared license file.".to_string()
                })?,
                "text/plain",
            ),
            _ => {
                return Err(
                    "The DreamSkin package manifest contains an unsupported file.".to_string(),
                )
            }
        };
        if file.media_type != media_type || file.bytes != bytes.len() {
            return Err("A DreamSkin package file does not match its manifest.".to_string());
        }
        verify_sha256(bytes, &file.sha256, &file.path)?;
    }
    if !seen.contains("theme.json") || !seen.contains("theme.css") || !seen.contains(image_name) {
        return Err("The DreamSkin package manifest is incomplete.".to_string());
    }
    if seen.contains("LICENSE.txt") != license_bytes.is_some() {
        return Err("The DreamSkin package license record is inconsistent.".to_string());
    }
    Ok(())
}

fn package_file_limit(name: &str) -> Result<usize, String> {
    match name {
        "manifest.json" | "LICENSE.txt" => Ok(TEXT_LIMIT),
        "manifest.sig" => Ok(4096),
        "theme.json" => Ok(THEME_LIMIT),
        "theme.css" => Ok(CSS_LIMIT),
        "background.png" | "background.jpg" | "background.webp" => Ok(IMAGE_LIMIT),
        _ => Err(format!(
            "The DreamSkin package contains an unsupported file: {name}"
        )),
    }
}

fn client(timeout_seconds: u64) -> Result<Client, String> {
    Client::builder()
        .user_agent(concat!(
            "Codex-Switch/",
            env!("CARGO_PKG_VERSION"),
            " DreamSkin"
        ))
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(8))
        .timeout(Duration::from_secs(timeout_seconds))
        .build()
        .map_err(|error| format!("Could not prepare the DreamSkin request: {error}"))
}

fn download(
    url: &str,
    limit: usize,
    expected_content_type: &str,
    timeout_seconds: u64,
) -> Result<Vec<u8>, String> {
    let response = client(timeout_seconds)?
        .get(url)
        .header(header::ACCEPT, expected_content_type)
        .send()
        .map_err(|error| format!("Could not reach DreamSkin community: {error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "DreamSkin community returned HTTP {}.",
            response.status()
        ));
    }
    let content_type = response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .map(str::trim)
        .unwrap_or_default();
    if content_type != expected_content_type {
        return Err("DreamSkin community returned an unsupported response.".to_string());
    }
    if response
        .content_length()
        .is_some_and(|length| length == 0 || length > limit as u64)
    {
        return Err("The DreamSkin response is too large.".to_string());
    }
    let mut bytes = Vec::new();
    response
        .take((limit + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("The DreamSkin response could not be read: {error}"))?;
    if bytes.is_empty() || bytes.len() > limit {
        return Err("The DreamSkin response is empty or too large.".to_string());
    }
    Ok(bytes)
}

fn api_url(relative: &str) -> Result<String, String> {
    let origin = Url::parse(&format!("{API_ORIGIN}/")).expect("fixed DreamSkin URL is valid");
    let url = origin
        .join(relative)
        .map_err(|_| "The DreamSkin API path is invalid.".to_string())?;
    if url.scheme() != origin.scheme() || url.host_str() != origin.host_str() {
        return Err("The DreamSkin API path is invalid.".to_string());
    }
    Ok(url.to_string())
}

fn valid_theme_id(value: &str) -> bool {
    let mut bytes = value.bytes();
    bytes
        .next()
        .is_some_and(|byte| byte.is_ascii_alphanumeric())
        && value.len() <= 80
        && value.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'-' | b'_' | b'.')
        })
}

fn safe_text(value: &str, maximum: usize) -> bool {
    let trimmed = value.trim();
    value == trimmed
        && !value.is_empty()
        && value.chars().count() <= maximum
        && value.chars().all(|character| !character.is_control())
}

fn valid_semver(value: &str) -> bool {
    let parts = value.split('.').collect::<Vec<_>>();
    parts.len() == 3
        && value.len() <= 32
        && parts.iter().all(|part| {
            !part.is_empty()
                && part.bytes().all(|byte| byte.is_ascii_digit())
                && (*part == "0" || !part.starts_with('0'))
        })
}

fn valid_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn verify_sha256(bytes: &[u8], expected: &str, label: &str) -> Result<(), String> {
    if !valid_sha256(expected) || format!("{:x}", Sha256::digest(bytes)) != expected {
        Err(format!(
            "The downloaded {label} failed its integrity check."
        ))
    } else {
        Ok(())
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

fn community_root() -> Result<PathBuf, String> {
    Ok(state_root()?.join("community"))
}

fn cache_path(offset: usize, limit: usize) -> Result<PathBuf, String> {
    Ok(community_root()?.join(format!("page-{offset}-{limit}.json")))
}

fn install_records_path() -> Result<PathBuf, String> {
    Ok(community_root()?.join("installed.json"))
}

fn read_cached_page(offset: usize, limit: usize) -> Result<ApiPage, String> {
    let bytes = fs::read(cache_path(offset, limit)?)
        .map_err(|_| "No saved DreamSkin community page is available.".to_string())?;
    if bytes.len() > JSON_LIMIT {
        return Err("The saved DreamSkin community page is invalid.".to_string());
    }
    let page: ApiPage = serde_json::from_slice(&bytes)
        .map_err(|_| "The saved DreamSkin community page is invalid.".to_string())?;
    validate_page(&page, limit)?;
    Ok(page)
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
    .map_err(|_| "The DreamSkin install record is invalid.".to_string())?;
    if records.schema_version != schema_version() {
        return Err("The DreamSkin install record needs a newer app version.".to_string());
    }
    Ok(records)
}

fn record_install(theme_id: &str, version: &str) -> Result<(), String> {
    let mut records = read_install_records()?;
    records
        .themes
        .insert(theme_id.to_string(), version.to_string());
    write_json(&install_records_path()?, &records)
}

fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "The DreamSkin data path is invalid.".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Could not prepare the DreamSkin data folder: {error}"))?;
    let temporary = parent.join(format!(".community-{}.tmp", Uuid::new_v4().simple()));
    let bytes = serde_json::to_vec(value)
        .map_err(|error| format!("Could not save DreamSkin community data: {error}"))?;
    fs::write(&temporary, bytes)
        .map_err(|error| format!("Could not save DreamSkin community data: {error}"))?;
    if path.is_file() {
        fs::remove_file(path)
            .map_err(|error| format!("Could not update DreamSkin community data: {error}"))?;
    }
    fs::rename(&temporary, path)
        .map_err(|error| format!("Could not finish saving DreamSkin community data: {error}"))
}

const fn schema_version() -> u8 {
    1
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn page_requests_are_bounded() {
        assert!(validate_page_request(0, 24).is_ok());
        assert!(validate_page_request(0, 0).is_err());
        assert!(validate_page_request(0, 49).is_err());
        assert!(validate_page_request(500, 24).is_err());
    }

    #[test]
    fn version_ids_and_theme_ids_are_strict() {
        assert!(validate_version_id("ver_1234abcd").is_ok());
        assert!(validate_version_id("../theme").is_err());
        assert!(valid_theme_id("calm.theme-1"));
        assert!(!valid_theme_id("../theme"));
    }
}
