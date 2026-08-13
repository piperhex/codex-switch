use std::{
    collections::BTreeMap,
    env, fs,
    io::{Cursor, Write},
    path::{Component, Path, PathBuf},
};

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{Manager, Runtime};
use uuid::Uuid;
use zip::{write::SimpleFileOptions, CompressionMethod, ZipArchive, ZipWriter};

use crate::{cloud, storage::write_json_atomic};

pub(crate) const MAX_SKILL_ARCHIVE_BYTES: usize = 1024 * 1024;
const MAX_SKILL_EXPANDED_BYTES: u64 = 10 * 1024 * 1024;
const MAX_SKILL_ARCHIVE_ENTRIES: usize = 512;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SkillMarketItem {
    pub(crate) id: String,
    pub(crate) title: String,
    pub(crate) description: String,
    pub(crate) version: String,
    pub(crate) archive_size: u64,
    pub(crate) archive_sha256: String,
    pub(crate) has_preview: bool,
    pub(crate) uploader_id: Option<String>,
    #[serde(default)]
    pub(crate) official: bool,
    pub(crate) install_count: u64,
    pub(crate) created_at: String,
    pub(crate) updated_at: String,
    #[serde(default)]
    pub(crate) installed: bool,
    #[serde(default)]
    pub(crate) installed_version: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SkillMarketResponse {
    pub(crate) items: Vec<SkillMarketItem>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SkillPreviewInput {
    file_name: String,
    mime_type: String,
    data_base64: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SkillPublishRequest {
    title: String,
    description: String,
    version: String,
    skill_id: Option<String>,
    package_path: String,
    package_kind: String,
    preview: Option<SkillPreviewInput>,
}

#[derive(Debug)]
pub(crate) struct SkillPreview {
    pub(crate) file_name: String,
    pub(crate) mime_type: String,
    pub(crate) data: Vec<u8>,
}

#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SkillInstallRegistry {
    installed: BTreeMap<String, InstalledSkill>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct InstalledSkill {
    directory: String,
    version: String,
}

#[derive(Debug)]
struct ArchiveLayout {
    root_prefix: Option<PathBuf>,
}

fn skills_root() -> Result<PathBuf, String> {
    if let Some(codex_home) = env::var_os("CODEX_HOME").filter(|value| !value.is_empty()) {
        return Ok(PathBuf::from(codex_home).join("skills"));
    }
    dirs::home_dir()
        .map(|home| home.join(".codex").join("skills"))
        .ok_or_else(|| "Could not resolve the Codex skills directory".to_string())
}

fn registry_path<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join("skill-market-installs.json"))
        .map_err(|error| format!("Could not resolve the skill install registry: {error}"))
}

fn read_registry<R: Runtime>(app: &tauri::AppHandle<R>) -> SkillInstallRegistry {
    let Ok(path) = registry_path(app) else {
        return SkillInstallRegistry::default();
    };
    let Ok(data) = fs::read(path) else {
        return SkillInstallRegistry::default();
    };
    serde_json::from_slice(&data).unwrap_or_default()
}

fn write_registry<R: Runtime>(
    app: &tauri::AppHandle<R>,
    registry: &SkillInstallRegistry,
) -> Result<(), String> {
    let path = registry_path(app)?;
    let parent = path
        .parent()
        .ok_or_else(|| "Skill install registry path has no parent".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Could not create the skill registry directory: {error}"))?;
    let value = serde_json::to_value(registry)
        .map_err(|error| format!("Could not serialize the skill registry: {error}"))?;
    write_json_atomic(&path, &value)
}

fn safe_relative_path(path: &Path) -> bool {
    !path.as_os_str().is_empty()
        && path
            .components()
            .all(|component| matches!(component, Component::Normal(_) | Component::CurDir))
}

fn inspect_archive(data: &[u8]) -> Result<ArchiveLayout, String> {
    if data.is_empty() || data.len() > MAX_SKILL_ARCHIVE_BYTES {
        return Err("Skill archive must not exceed 1 MB".to_string());
    }
    let mut archive = ZipArchive::new(Cursor::new(data))
        .map_err(|error| format!("Skill archive is not a valid ZIP file: {error}"))?;
    if archive.is_empty() || archive.len() > MAX_SKILL_ARCHIVE_ENTRIES {
        return Err(format!(
            "Skill archive must contain 1-{MAX_SKILL_ARCHIVE_ENTRIES} entries"
        ));
    }
    let mut expanded_bytes = 0_u64;
    let mut skill_files = Vec::new();
    for index in 0..archive.len() {
        let file = archive
            .by_index(index)
            .map_err(|error| format!("Could not inspect skill archive entry: {error}"))?;
        let path = file
            .enclosed_name()
            .ok_or_else(|| "Skill archive contains an unsafe path".to_string())?;
        if !safe_relative_path(&path) {
            return Err("Skill archive contains an unsafe path".to_string());
        }
        if file
            .unix_mode()
            .is_some_and(|mode| mode & 0o170000 == 0o120000)
        {
            return Err("Skill archive must not contain symbolic links".to_string());
        }
        expanded_bytes = expanded_bytes.saturating_add(file.size());
        if expanded_bytes > MAX_SKILL_EXPANDED_BYTES {
            return Err("Expanded skill archive must not exceed 10 MB".to_string());
        }
        if !file.is_dir()
            && path
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.eq_ignore_ascii_case("SKILL.md"))
        {
            skill_files.push(path);
        }
    }
    if skill_files.len() != 1 {
        return Err("Skill archive must contain exactly one SKILL.md file".to_string());
    }
    Ok(ArchiveLayout {
        root_prefix: skill_files[0]
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty())
            .map(Path::to_path_buf),
    })
}

fn collect_folder_files(
    root: &Path,
    directory: &Path,
    files: &mut Vec<PathBuf>,
    expanded_bytes: &mut u64,
) -> Result<(), String> {
    let entries = fs::read_dir(directory)
        .map_err(|error| format!("Could not read {}: {error}", directory.display()))?;
    for entry in entries {
        let entry = entry.map_err(|error| format!("Could not read skill folder entry: {error}"))?;
        let file_type = entry
            .file_type()
            .map_err(|error| format!("Could not inspect {}: {error}", entry.path().display()))?;
        if file_type.is_symlink() {
            return Err("Skill folders must not contain symbolic links".to_string());
        }
        if file_type.is_dir() {
            collect_folder_files(root, &entry.path(), files, expanded_bytes)?;
        } else if file_type.is_file() {
            let relative = entry
                .path()
                .strip_prefix(root)
                .map_err(|error| format!("Could not normalize skill folder path: {error}"))?
                .to_path_buf();
            if !safe_relative_path(&relative) {
                return Err("Skill folder contains an unsafe path".to_string());
            }
            *expanded_bytes = expanded_bytes
                .saturating_add(entry.metadata().map_err(|error| error.to_string())?.len());
            if *expanded_bytes > MAX_SKILL_EXPANDED_BYTES {
                return Err("Skill folder must not exceed 10 MB before compression".to_string());
            }
            files.push(relative);
            if files.len() > MAX_SKILL_ARCHIVE_ENTRIES {
                return Err(format!(
                    "Skill folder must not contain more than {MAX_SKILL_ARCHIVE_ENTRIES} files"
                ));
            }
        }
    }
    Ok(())
}

fn zip_folder(path: &Path) -> Result<Vec<u8>, String> {
    if !path.is_dir() {
        return Err("Selected skill folder does not exist".to_string());
    }
    let mut files = Vec::new();
    let mut expanded_bytes = 0_u64;
    collect_folder_files(path, path, &mut files, &mut expanded_bytes)?;
    files.sort();
    if files.is_empty() {
        return Err("Selected skill folder is empty".to_string());
    }

    let cursor = Cursor::new(Vec::new());
    let mut writer = ZipWriter::new(cursor);
    let options = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .unix_permissions(0o644);
    for relative in files {
        let zip_name = relative.to_string_lossy().replace('\\', "/");
        writer
            .start_file(zip_name, options)
            .map_err(|error| format!("Could not create skill archive: {error}"))?;
        let mut source = fs::File::open(path.join(&relative))
            .map_err(|error| format!("Could not read {}: {error}", relative.display()))?;
        std::io::copy(&mut source, &mut writer)
            .map_err(|error| format!("Could not compress {}: {error}", relative.display()))?;
    }
    let archive = writer
        .finish()
        .map_err(|error| format!("Could not finalize skill archive: {error}"))?
        .into_inner();
    if archive.len() > MAX_SKILL_ARCHIVE_BYTES {
        return Err("Compressed skill folder exceeds the 1 MB limit".to_string());
    }
    inspect_archive(&archive)?;
    Ok(archive)
}

fn read_archive(path: &Path) -> Result<Vec<u8>, String> {
    let metadata = fs::metadata(path)
        .map_err(|error| format!("Could not read selected skill archive: {error}"))?;
    if !metadata.is_file() {
        return Err("Selected skill archive does not exist".to_string());
    }
    if metadata.len() > MAX_SKILL_ARCHIVE_BYTES as u64 {
        return Err("Skill archive must not exceed 1 MB".to_string());
    }
    let data = fs::read(path)
        .map_err(|error| format!("Could not read selected skill archive: {error}"))?;
    inspect_archive(&data)?;
    Ok(data)
}

fn decode_preview(input: Option<SkillPreviewInput>) -> Result<Option<SkillPreview>, String> {
    let Some(input) = input else {
        return Ok(None);
    };
    if !matches!(
        input.mime_type.as_str(),
        "image/jpeg" | "image/png" | "image/webp"
    ) {
        return Err("Skill preview must be a JPEG, PNG or WebP image".to_string());
    }
    let data = BASE64_STANDARD
        .decode(input.data_base64)
        .map_err(|error| format!("Skill preview image is invalid: {error}"))?;
    if data.len() > MAX_SKILL_ARCHIVE_BYTES {
        return Err("Skill preview must not exceed 1 MB".to_string());
    }
    Ok(Some(SkillPreview {
        file_name: input.file_name,
        mime_type: input.mime_type,
        data,
    }))
}

fn installed_path(root: &Path, value: &str) -> Option<PathBuf> {
    let relative = Path::new(value);
    if !safe_relative_path(relative) || relative.components().count() != 1 {
        return None;
    }
    Some(root.join(relative))
}

fn mark_installed<R: Runtime>(
    app: &tauri::AppHandle<R>,
    items: &mut [SkillMarketItem],
) -> Result<(), String> {
    let root = skills_root()?;
    let mut registry = read_registry(app);
    registry.installed.retain(|_, installed| {
        installed_path(&root, &installed.directory)
            .is_some_and(|path| path.join("SKILL.md").is_file())
    });
    for item in items {
        item.installed_version = registry
            .installed
            .get(&item.id)
            .map(|value| value.version.clone());
        item.installed = item.installed_version.as_deref() == Some(item.version.as_str());
    }
    write_registry(app, &registry)
}

fn extract_archive(data: &[u8], destination: &Path, layout: &ArchiveLayout) -> Result<(), String> {
    let mut archive = ZipArchive::new(Cursor::new(data))
        .map_err(|error| format!("Downloaded skill archive is invalid: {error}"))?;
    for index in 0..archive.len() {
        let mut file = archive
            .by_index(index)
            .map_err(|error| format!("Could not read downloaded skill entry: {error}"))?;
        let enclosed = file
            .enclosed_name()
            .ok_or_else(|| "Downloaded skill archive contains an unsafe path".to_string())?;
        let relative = match layout.root_prefix.as_deref() {
            Some(prefix) => {
                let Ok(relative) = enclosed.strip_prefix(prefix) else {
                    continue;
                };
                relative.to_path_buf()
            }
            None => enclosed,
        };
        if relative.as_os_str().is_empty() {
            continue;
        }
        let output = destination.join(&relative);
        if file.is_dir() {
            fs::create_dir_all(&output)
                .map_err(|error| format!("Could not create {}: {error}", output.display()))?;
            continue;
        }
        if let Some(parent) = output.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("Could not create {}: {error}", parent.display()))?;
        }
        let mut target = fs::File::create(&output)
            .map_err(|error| format!("Could not create {}: {error}", output.display()))?;
        std::io::copy(&mut file, &mut target)
            .map_err(|error| format!("Could not extract {}: {error}", output.display()))?;
        target
            .flush()
            .map_err(|error| format!("Could not finish {}: {error}", output.display()))?;
    }
    if !destination.join("SKILL.md").is_file() {
        return Err("Downloaded skill did not produce a root SKILL.md file".to_string());
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn list_market_skills<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<Vec<SkillMarketItem>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut items = cloud::fetch_skill_market_items(&app)?;
        mark_installed(&app, &mut items)?;
        Ok(items)
    })
    .await
    .map_err(|error| format!("Skill market task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn upload_market_skill<R: Runtime>(
    app: tauri::AppHandle<R>,
    request: SkillPublishRequest,
) -> Result<SkillMarketItem, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let title = request.title.trim();
        let description = request.description.trim();
        let version = request.version.trim();
        if title.is_empty() || title.chars().count() > 120 {
            return Err("Skill title must contain 1-120 characters".to_string());
        }
        if description.is_empty() || description.chars().count() > 1000 {
            return Err("Skill description must contain 1-1000 characters".to_string());
        }
        if version.is_empty()
            || version.chars().count() > 40
            || !version
                .chars()
                .all(|character| character.is_ascii_alphanumeric() || "._+-".contains(character))
        {
            return Err("Skill version contains unsupported characters".to_string());
        }
        let path = Path::new(&request.package_path);
        let archive = match request.package_kind.as_str() {
            "archive" => read_archive(path)?,
            "folder" => zip_folder(path)?,
            _ => return Err("Unsupported skill package type".to_string()),
        };
        let file_name = path
            .file_name()
            .and_then(|value| value.to_str())
            .filter(|value| !value.is_empty())
            .map(|value| {
                if value.to_ascii_lowercase().ends_with(".zip") {
                    value.to_string()
                } else {
                    format!("{value}.zip")
                }
            })
            .unwrap_or_else(|| "skill.zip".to_string());
        let preview = decode_preview(request.preview)?;
        cloud::upload_skill_market_item(
            &app,
            cloud::SkillMarketUpload {
                title,
                description,
                version,
                skill_id: request.skill_id.as_deref(),
                archive_file_name: &file_name,
                archive: &archive,
                preview: preview.as_ref(),
            },
        )
    })
    .await
    .map_err(|error| format!("Skill upload task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn install_market_skill<R: Runtime>(
    app: tauri::AppHandle<R>,
    skill: SkillMarketItem,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = skills_root()?;
        fs::create_dir_all(&root)
            .map_err(|error| format!("Could not create {}: {error}", root.display()))?;
        let mut registry = read_registry(&app);
        if registry.installed.get(&skill.id).is_some_and(|installed| {
            installed.version == skill.version
                && installed_path(&root, &installed.directory)
                    .is_some_and(|path| path.join("SKILL.md").is_file())
        }) {
            return Ok(());
        }

        let archive = cloud::download_skill_market_archive(&app, &skill.id)?;
        if archive.len() > MAX_SKILL_ARCHIVE_BYTES {
            return Err("Downloaded skill archive exceeds the 1 MB limit".to_string());
        }
        let actual_sha256 = format!("{:x}", Sha256::digest(&archive));
        if !actual_sha256.eq_ignore_ascii_case(&skill.archive_sha256) {
            return Err("Downloaded skill archive failed integrity verification".to_string());
        }
        let layout = inspect_archive(&archive)?;
        let short_id = skill
            .id
            .chars()
            .filter(|character| character.is_ascii_hexdigit())
            .take(12)
            .collect::<String>();
        let directory_name = format!(
            "market-{}",
            if short_id.is_empty() {
                Uuid::new_v4().to_string()
            } else {
                short_id
            }
        );
        let destination = root.join(&directory_name);
        let managed_destination = registry
            .installed
            .get(&skill.id)
            .and_then(|installed| installed_path(&root, &installed.directory));
        if destination.exists() && managed_destination.as_deref() != Some(destination.as_path()) {
            return Err("A local skill already uses the marketplace install directory".to_string());
        }
        let temporary = root.join(format!(".codex-switch-skill-{}", Uuid::new_v4()));
        fs::create_dir(&temporary)
            .map_err(|error| format!("Could not create temporary skill directory: {error}"))?;
        if let Err(error) = extract_archive(&archive, &temporary, &layout) {
            let _ = fs::remove_dir_all(&temporary);
            return Err(error);
        }
        let backup = root.join(format!(".codex-switch-skill-backup-{}", Uuid::new_v4()));
        if destination.exists() {
            fs::rename(&destination, &backup).map_err(|error| {
                format!("Could not prepare the installed skill for update: {error}")
            })?;
        }
        if let Err(error) = fs::rename(&temporary, &destination) {
            let _ = fs::remove_dir_all(&temporary);
            if backup.exists() {
                let _ = fs::rename(&backup, &destination);
            }
            return Err(format!("Could not install skill: {error}"));
        }
        registry.installed.insert(
            skill.id,
            InstalledSkill {
                directory: directory_name,
                version: skill.version,
            },
        );
        if let Err(error) = write_registry(&app, &registry) {
            let _ = fs::remove_dir_all(&destination);
            if backup.exists() {
                let _ = fs::rename(&backup, &destination);
            }
            return Err(error);
        }
        if backup.exists() {
            fs::remove_dir_all(&backup).map_err(|error| {
                format!("Skill updated, but the old version could not be removed: {error}")
            })?;
        }
        Ok(())
    })
    .await
    .map_err(|error| format!("Skill install task failed: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn archive_with_skill(path: &str) -> Vec<u8> {
        let cursor = Cursor::new(Vec::new());
        let mut writer = ZipWriter::new(cursor);
        writer
            .start_file(path, SimpleFileOptions::default())
            .unwrap();
        writer.write_all(b"---\nname: demo\n---\n").unwrap();
        writer.finish().unwrap().into_inner()
    }

    #[test]
    fn accepts_root_and_wrapped_skill_archives() {
        assert!(inspect_archive(&archive_with_skill("SKILL.md")).is_ok());
        let wrapped = inspect_archive(&archive_with_skill("demo/SKILL.md")).unwrap();
        assert_eq!(wrapped.root_prefix, Some(PathBuf::from("demo")));
    }

    #[test]
    fn rejects_archives_without_a_skill_manifest() {
        let cursor = Cursor::new(Vec::new());
        let mut writer = ZipWriter::new(cursor);
        writer
            .start_file("README.md", SimpleFileOptions::default())
            .unwrap();
        writer.write_all(b"demo").unwrap();
        let archive = writer.finish().unwrap().into_inner();
        assert!(inspect_archive(&archive).is_err());
    }
}
