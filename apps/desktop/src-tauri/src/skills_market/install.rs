use std::{fs, path::PathBuf};

use sha2::{Digest, Sha256};
use tauri::Runtime;
use uuid::Uuid;

use super::{
    cloud, extract_archive, inspect_archive, installed, skills_root, ArchiveLayout,
    SkillMarketItem, MAX_SKILL_ARCHIVE_BYTES,
};

fn download_archive<R: Runtime>(
    app: &tauri::AppHandle<R>,
    skill: &SkillMarketItem,
) -> Result<(Vec<u8>, ArchiveLayout), String> {
    let archive = cloud::download_skill_market_archive(app, &skill.id)?;
    if archive.len() > MAX_SKILL_ARCHIVE_BYTES {
        return Err("Downloaded skill archive exceeds the 1 MB limit".to_string());
    }
    let actual_sha256 = format!("{:x}", Sha256::digest(&archive));
    if !actual_sha256.eq_ignore_ascii_case(&skill.archive_sha256) {
        return Err("Downloaded skill archive failed integrity verification".to_string());
    }
    let layout = inspect_archive(&archive)?;
    Ok((archive, layout))
}

fn directory_name(skill_id: &str) -> String {
    let short_id = skill_id
        .chars()
        .filter(|character| character.is_ascii_hexdigit())
        .take(12)
        .collect::<String>();
    let suffix = if short_id.is_empty() {
        Uuid::new_v4().to_string()
    } else {
        short_id
    };
    format!("market-{suffix}")
}

fn prepare_temporary(
    root: &std::path::Path,
    archive: &[u8],
    layout: &ArchiveLayout,
    enabled: bool,
) -> Result<PathBuf, String> {
    let temporary = root.join(format!(".codex-switch-skill-{}", Uuid::new_v4()));
    fs::create_dir(&temporary)
        .map_err(|error| format!("Could not create temporary skill directory: {error}"))?;
    let result = extract_archive(archive, &temporary, layout).and_then(|()| {
        if enabled {
            Ok(())
        } else {
            installed::set_directory_enabled(&temporary, false)
        }
    });
    if let Err(error) = result {
        if let Err(cleanup_error) = fs::remove_dir_all(&temporary) {
            return Err(format!(
                "{error} Temporary files could not be removed: {cleanup_error}"
            ));
        }
        return Err(error);
    }
    Ok(temporary)
}

fn replace_destination(
    root: &std::path::Path,
    temporary: &std::path::Path,
    destination: &std::path::Path,
) -> Result<PathBuf, String> {
    let backup = root.join(format!(".codex-switch-skill-backup-{}", Uuid::new_v4()));
    if destination.exists() {
        fs::rename(destination, &backup).map_err(|error| {
            format!("Could not prepare the installed skill for update: {error}")
        })?;
    }
    if let Err(error) = fs::rename(temporary, destination) {
        if backup.exists() {
            fs::rename(&backup, destination).map_err(|restore| {
                format!("Could not install skill: {error}. Restore failed: {restore}")
            })?;
        }
        return Err(format!("Could not install skill: {error}"));
    }
    Ok(backup)
}

fn managed_destination(
    root: &std::path::Path,
    registry: &installed::SkillInstallRegistry,
    skill: &SkillMarketItem,
    directory_name: &str,
) -> Result<PathBuf, String> {
    let destination = root.join(directory_name);
    let current = registry
        .installed
        .get(&skill.id)
        .and_then(|item| installed::installed_path(root, &item.directory));
    if destination.exists() && current.as_deref() != Some(destination.as_path()) {
        return Err("A local skill already uses the marketplace install directory".to_string());
    }
    Ok(destination)
}

fn save_install<R: Runtime>(
    app: &tauri::AppHandle<R>,
    registry: &mut installed::SkillInstallRegistry,
    skill_id: String,
    record: installed::InstalledSkill,
) -> Result<(), String> {
    registry.installed.insert(skill_id, record);
    installed::write_registry(app, registry)
}

fn rollback_install(destination: &std::path::Path, backup: &std::path::Path) -> Result<(), String> {
    fs::remove_dir_all(destination)
        .map_err(|error| format!("New plugin files could not be removed: {error}"))?;
    if backup.exists() {
        fs::rename(backup, destination).map_err(|error| {
            format!("The previous plugin version could not be restored: {error}")
        })?;
    }
    Ok(())
}

pub(super) fn install_market_skill<R: Runtime>(
    app: &tauri::AppHandle<R>,
    skill: SkillMarketItem,
) -> Result<(), String> {
    let root = skills_root(app)?;
    fs::create_dir_all(&root)
        .map_err(|error| format!("Could not create {}: {error}", root.display()))?;
    let mut registry = installed::read_registry(app);
    if registry
        .installed
        .get(&skill.id)
        .is_some_and(|item| item.version == skill.version && installed::skill_exists(&root, item))
    {
        return Ok(());
    }
    let enabled = registry
        .installed
        .get(&skill.id)
        .map(|item| item.enabled)
        .unwrap_or(true);
    let (archive, layout) = download_archive(app, &skill)?;
    let directory = directory_name(&skill.id);
    let destination = managed_destination(&root, &registry, &skill, &directory)?;
    let temporary = prepare_temporary(&root, &archive, &layout, enabled)?;
    let backup = replace_destination(&root, &temporary, &destination)?;
    let SkillMarketItem { id, version, .. } = skill;
    let record = installed::InstalledSkill {
        directory,
        version,
        enabled,
    };
    if let Err(error) = save_install(app, &mut registry, id, record) {
        rollback_install(&destination, &backup)
            .map_err(|rollback| format!("{error} {rollback}"))?;
        return Err(error);
    }
    if backup.exists() {
        fs::remove_dir_all(&backup).map_err(|error| {
            format!("Plugin updated, but its old version could not be removed: {error}")
        })?;
    }
    Ok(())
}
