use std::{
    fs::{self, File},
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex, OnceLock,
    },
    thread,
    time::Duration,
};

use md5::{Digest as Md5Digest, Md5};
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use zip::ZipArchive;

use crate::{
    dream_skin::{state_root, DreamSkinResourcesStatus},
    dream_skin_native::BUILT_IN_THEME_IDS,
};

const RELEASES_API: &str =
    "https://api.github.com/repos/piperhex/codex-switch/releases?per_page=50";
const RELEASE_TAG_PREFIX: &str = "dream-skin-";
const RESOURCE_ASSET_PREFIX: &str = "dream-skin-resources-";
const MAX_DOWNLOAD_BYTES: u64 = 512 * 1024 * 1024;
const MAX_EXTRACTED_BYTES: u64 = 512 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES: usize = 1_000;
const MAX_RESOURCE_FILE_BYTES: u64 = 16 * 1024 * 1024;

static UPDATE_RUNNING: AtomicBool = AtomicBool::new(false);
static RESOURCE_STATUS: OnceLock<Mutex<DreamSkinResourcesStatus>> = OnceLock::new();

#[derive(Debug, Deserialize)]
struct GithubRelease {
    tag_name: String,
    draft: bool,
    assets: Vec<GithubAsset>,
}

#[derive(Debug, Deserialize)]
struct GithubAsset {
    name: String,
    browser_download_url: String,
    size: u64,
}

#[derive(Clone)]
struct ResourceRelease {
    version: String,
    download_url: String,
    size: u64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResourceMarker {
    schema_version: u32,
    version: String,
}

fn resources_root() -> Result<PathBuf, String> {
    Ok(state_root()?.join("resource-packs"))
}

fn marker_path() -> Result<PathBuf, String> {
    Ok(resources_root()?.join("current.json"))
}

fn valid_version(version: &str) -> bool {
    version.len() == 32
        && version
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn read_marker() -> Option<ResourceMarker> {
    let bytes = fs::read(marker_path().ok()?).ok()?;
    let marker: ResourceMarker = serde_json::from_slice(&bytes).ok()?;
    if marker.schema_version != 1 || !valid_version(&marker.version) {
        return None;
    }
    let root = resources_root().ok()?.join(&marker.version);
    if root.join("presets").is_dir() {
        Some(marker)
    } else {
        None
    }
}

fn initial_status() -> DreamSkinResourcesStatus {
    let marker = read_marker();
    DreamSkinResourcesStatus {
        phase: if marker.is_some() { "ready" } else { "idle" }.to_string(),
        installed: marker.is_some(),
        installed_version: marker.as_ref().map(|value| value.version.clone()),
        available_version: None,
        downloaded_bytes: 0,
        total_bytes: None,
        error: None,
    }
}

fn status_cell() -> &'static Mutex<DreamSkinResourcesStatus> {
    RESOURCE_STATUS.get_or_init(|| Mutex::new(initial_status()))
}

fn update_status(update: impl FnOnce(&mut DreamSkinResourcesStatus)) {
    let mut current = status_cell()
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    update(&mut current);
}

pub(crate) fn status() -> DreamSkinResourcesStatus {
    status_cell()
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .clone()
}

pub(crate) fn installed_pack_root() -> Result<PathBuf, String> {
    let marker = read_marker()
        .ok_or_else(|| "Dream Skin preset resources are still downloading.".to_string())?;
    Ok(resources_root()?.join(marker.version))
}

pub(crate) fn start_background_update() {
    if UPDATE_RUNNING
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return;
    }
    if let Some(marker) = read_marker() {
        if let Ok(root) = resources_root() {
            cleanup_old_packs(&root, &marker.version);
        }
    }
    update_status(|current| {
        current.phase = "checking".to_string();
        current.downloaded_bytes = 0;
        current.total_bytes = None;
        current.error = None;
    });
    let spawn = thread::Builder::new()
        .name("dream-skin-resource-updater".to_string())
        .spawn(|| {
            if let Err(error) = run_update() {
                let marker = read_marker();
                update_status(|current| {
                    current.phase = "error".to_string();
                    current.installed = marker.is_some();
                    current.installed_version = marker.as_ref().map(|value| value.version.clone());
                    current.error = Some(error);
                });
            }
            UPDATE_RUNNING.store(false, Ordering::Release);
        });
    if let Err(error) = spawn {
        UPDATE_RUNNING.store(false, Ordering::Release);
        update_status(|current| {
            current.phase = "error".to_string();
            current.error = Some(format!("Failed to start the resource downloader: {error}"));
        });
    }
}

fn run_update() -> Result<(), String> {
    let client = crate::system_proxy::apply(Client::builder())
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(30 * 60))
        .user_agent("codex-switch-dream-skin-resources")
        .build()
        .map_err(|error| format!("Failed to initialize resource download: {error}"))?;
    let release = latest_release(&client)?;
    let installed = read_marker();
    update_status(|current| {
        current.available_version = Some(release.version.clone());
        current.total_bytes = Some(release.size);
    });
    if installed
        .as_ref()
        .is_some_and(|marker| marker.version == release.version)
    {
        update_status(|current| {
            current.phase = "ready".to_string();
            current.installed = true;
            current.installed_version = Some(release.version);
            current.downloaded_bytes = release.size;
            current.error = None;
        });
        return Ok(());
    }
    download_and_install(&client, &release)?;
    update_status(|current| {
        current.phase = "ready".to_string();
        current.installed = true;
        current.installed_version = Some(release.version.clone());
        current.available_version = Some(release.version.clone());
        current.downloaded_bytes = release.size;
        current.total_bytes = Some(release.size);
        current.error = None;
    });
    Ok(())
}

fn latest_release(client: &Client) -> Result<ResourceRelease, String> {
    let releases = client
        .get(RELEASES_API)
        .send()
        .and_then(reqwest::blocking::Response::error_for_status)
        .map_err(|error| format!("Failed to check Dream Skin resources: {error}"))?
        .json::<Vec<GithubRelease>>()
        .map_err(|error| format!("Failed to read the resource release list: {error}"))?;
    select_release(releases)
        .ok_or_else(|| "No Dream Skin resource release is available yet.".to_string())
}

fn select_release(releases: Vec<GithubRelease>) -> Option<ResourceRelease> {
    let release = releases.into_iter().find(|release| {
        !release.draft
            && release
                .tag_name
                .strip_prefix(RELEASE_TAG_PREFIX)
                .is_some_and(valid_version)
    })?;
    let version = release.tag_name.strip_prefix(RELEASE_TAG_PREFIX)?;
    let expected_name = format!("{RESOURCE_ASSET_PREFIX}{version}.zip");
    let asset = release.assets.into_iter().find(|asset| {
        asset.name == expected_name && asset.size > 0 && asset.size <= MAX_DOWNLOAD_BYTES
    })?;
    Some(ResourceRelease {
        version: version.to_string(),
        download_url: asset.browser_download_url,
        size: asset.size,
    })
}

fn download_and_install(client: &Client, release: &ResourceRelease) -> Result<(), String> {
    let root = resources_root()?;
    fs::create_dir_all(&root)
        .map_err(|error| format!("Failed to create {}: {error}", root.display()))?;
    let archive_path = root.join(format!(".download-{}.zip", Uuid::new_v4()));
    let staging = root.join(format!(".staging-{}", Uuid::new_v4()));
    let result = (|| {
        update_status(|current| {
            current.phase = "downloading".to_string();
            current.downloaded_bytes = 0;
            current.total_bytes = Some(release.size);
        });
        let mut response = client
            .get(&release.download_url)
            .send()
            .and_then(reqwest::blocking::Response::error_for_status)
            .map_err(|error| format!("Failed to download Dream Skin resources: {error}"))?;
        if response
            .content_length()
            .is_some_and(|size| size > MAX_DOWNLOAD_BYTES)
        {
            return Err("Dream Skin resource archive exceeds the download limit.".to_string());
        }
        let mut output = File::create(&archive_path)
            .map_err(|error| format!("Failed to create resource archive: {error}"))?;
        let mut hasher = Md5::new();
        let mut downloaded = 0_u64;
        let mut buffer = [0_u8; 64 * 1024];
        loop {
            let count = response
                .read(&mut buffer)
                .map_err(|error| format!("Failed while downloading resources: {error}"))?;
            if count == 0 {
                break;
            }
            downloaded = downloaded.saturating_add(count as u64);
            if downloaded > MAX_DOWNLOAD_BYTES {
                return Err("Dream Skin resource archive exceeds the download limit.".to_string());
            }
            output
                .write_all(&buffer[..count])
                .map_err(|error| format!("Failed to save resource archive: {error}"))?;
            hasher.update(&buffer[..count]);
            update_status(|current| current.downloaded_bytes = downloaded);
        }
        output
            .flush()
            .map_err(|error| format!("Failed to finish resource archive: {error}"))?;
        if downloaded != release.size {
            return Err(format!(
                "Dream Skin resource size mismatch: expected {}, received {downloaded}.",
                release.size
            ));
        }
        let digest = format!("{:x}", hasher.finalize());
        if digest != release.version {
            return Err(format!(
                "Dream Skin resource MD5 mismatch: expected {}, received {digest}.",
                release.version
            ));
        }
        extract_archive(&archive_path, &staging)?;
        validate_pack(&staging)?;
        let target = root.join(&release.version);
        if target.exists() {
            fs::remove_dir_all(&target)
                .map_err(|error| format!("Failed to replace old resource pack: {error}"))?;
        }
        fs::rename(&staging, &target)
            .map_err(|error| format!("Failed to activate resource pack: {error}"))?;
        write_marker(&root, &release.version)?;
        Ok(())
    })();
    let _ = fs::remove_file(&archive_path);
    if result.is_err() {
        let _ = fs::remove_dir_all(&staging);
    }
    result
}

fn extract_archive(archive_path: &Path, staging: &Path) -> Result<(), String> {
    fs::create_dir_all(staging)
        .map_err(|error| format!("Failed to create resource staging directory: {error}"))?;
    let file = File::open(archive_path)
        .map_err(|error| format!("Failed to open resource archive: {error}"))?;
    let mut archive = ZipArchive::new(file)
        .map_err(|error| format!("Dream Skin resource archive is invalid: {error}"))?;
    if archive.len() > MAX_ARCHIVE_ENTRIES {
        return Err("Dream Skin resource archive contains too many entries.".to_string());
    }
    let mut extracted_bytes = 0_u64;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| format!("Failed to read resource archive entry: {error}"))?;
        if entry
            .unix_mode()
            .is_some_and(|mode| mode & 0o170000 == 0o120000)
        {
            return Err("Dream Skin resource archive contains a symbolic link.".to_string());
        }
        let relative = entry
            .enclosed_name()
            .ok_or_else(|| "Dream Skin resource archive contains an unsafe path.".to_string())?;
        validate_archive_path(&relative, entry.is_dir())?;
        let destination = staging.join(&relative);
        if entry.is_dir() {
            fs::create_dir_all(&destination)
                .map_err(|error| format!("Failed to create resource directory: {error}"))?;
            continue;
        }
        extracted_bytes = extracted_bytes.saturating_add(entry.size());
        if entry.size() > MAX_RESOURCE_FILE_BYTES || extracted_bytes > MAX_EXTRACTED_BYTES {
            return Err("Dream Skin resource archive exceeds extraction limits.".to_string());
        }
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("Failed to create resource directory: {error}"))?;
        }
        let mut output = File::create(&destination)
            .map_err(|error| format!("Failed to create resource file: {error}"))?;
        std::io::copy(&mut entry, &mut output)
            .map_err(|error| format!("Failed to extract resource file: {error}"))?;
    }
    Ok(())
}

fn validate_archive_path(path: &Path, directory: bool) -> Result<(), String> {
    let components = path.components().collect::<Vec<_>>();
    if !directory && components.len() == 1 {
        let name = match components[0] {
            Component::Normal(value) => value.to_string_lossy(),
            _ => return Err("Dream Skin resource archive has an unexpected path.".to_string()),
        };
        if matches!(name.as_ref(), "LICENSE" | "NOTICE.md" | "SOURCES.json") {
            return Ok(());
        }
    }
    if components
        .iter()
        .any(|component| !matches!(component, Component::Normal(_)))
        || components.first().and_then(|value| match value {
            Component::Normal(value) => value.to_str(),
            _ => None,
        }) != Some("presets")
    {
        return Err("Dream Skin resource archive has an unexpected path.".to_string());
    }
    if directory && components.len() <= 3 {
        return Ok(());
    }
    if !directory && components.len() == 3 {
        let theme_id = match components[1] {
            Component::Normal(value) => value.to_string_lossy(),
            _ => return Err("Dream Skin resource archive has an invalid theme id.".to_string()),
        };
        if BUILT_IN_THEME_IDS.contains(&theme_id.as_ref()) {
            return Ok(());
        }
    }
    Err("Dream Skin resource archive contains an unexpected file.".to_string())
}

fn validate_pack(root: &Path) -> Result<(), String> {
    let presets = root.join("presets");
    for theme_id in BUILT_IN_THEME_IDS {
        let directory = presets.join(theme_id);
        let document: serde_json::Value = serde_json::from_slice(
            &fs::read(directory.join("theme.json"))
                .map_err(|error| format!("Theme {theme_id} metadata is missing: {error}"))?,
        )
        .map_err(|error| format!("Theme {theme_id} metadata is invalid: {error}"))?;
        if document.get("id").and_then(serde_json::Value::as_str) != Some(theme_id) {
            return Err(format!("Theme {theme_id} has mismatched metadata."));
        }
        let image = document
            .get("image")
            .and_then(serde_json::Value::as_str)
            .filter(|value| {
                !value.is_empty()
                    && Path::new(value).components().count() == 1
                    && Path::new(value)
                        .components()
                        .all(|component| matches!(component, Component::Normal(_)))
            })
            .ok_or_else(|| format!("Theme {theme_id} has an invalid image path."))?;
        let image_path = directory.join(image);
        let metadata = fs::metadata(&image_path)
            .map_err(|error| format!("Theme {theme_id} image is missing: {error}"))?;
        if !metadata.is_file() || metadata.len() == 0 || metadata.len() > MAX_RESOURCE_FILE_BYTES {
            return Err(format!("Theme {theme_id} image is invalid."));
        }
        let entries = fs::read_dir(&directory)
            .map_err(|error| format!("Theme {theme_id} directory is invalid: {error}"))?;
        for entry in entries {
            let entry =
                entry.map_err(|error| format!("Theme {theme_id} directory is invalid: {error}"))?;
            let name = entry.file_name();
            let allowed = name == "theme.json" || name.to_string_lossy() == image;
            if !allowed || !entry.path().is_file() {
                return Err(format!("Theme {theme_id} contains an unexpected file."));
            }
        }
    }
    Ok(())
}

fn write_marker(root: &Path, version: &str) -> Result<(), String> {
    let marker = ResourceMarker {
        schema_version: 1,
        version: version.to_string(),
    };
    let bytes = serde_json::to_vec_pretty(&marker)
        .map_err(|error| format!("Failed to serialize resource marker: {error}"))?;
    fs::write(root.join("current.json"), bytes)
        .map_err(|error| format!("Failed to activate resource version: {error}"))
}

fn cleanup_old_packs(root: &Path, current_version: &str) {
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name != current_version && valid_version(&name) && entry.path().is_dir() {
            let _ = fs::remove_dir_all(entry.path());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resource_versions_are_lowercase_md5_values() {
        assert!(valid_version("0123456789abcdef0123456789abcdef"));
        assert!(!valid_version("0123456789ABCDEF0123456789ABCDEF"));
        assert!(!valid_version("v1"));
    }

    #[test]
    fn release_selection_requires_matching_versioned_asset() {
        let version = "0123456789abcdef0123456789abcdef";
        let selected = select_release(vec![GithubRelease {
            tag_name: format!("dream-skin-{version}"),
            draft: false,
            assets: vec![GithubAsset {
                name: format!("dream-skin-resources-{version}.zip"),
                browser_download_url: "https://example.invalid/resources.zip".to_string(),
                size: 42,
            }],
        }])
        .expect("release should be selected");
        assert_eq!(selected.version, version);
        assert_eq!(selected.size, 42);
    }
}
