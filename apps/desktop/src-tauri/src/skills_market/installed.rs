use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{registry::SkillHome, SkillMarketItem};

const ACTIVE_MANIFEST: &str = "SKILL.md";
const DISABLED_MANIFEST: &str = "SKILL.md.codex-switch-disabled";

#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SkillInstallRegistry {
    pub(super) installed: BTreeMap<String, InstalledSkill>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct InstalledSkill {
    pub(super) directory: String,
    pub(super) version: String,
    #[serde(default = "enabled_by_default")]
    pub(super) enabled: bool,
}

const fn enabled_by_default() -> bool {
    true
}

pub(super) fn installed_path(root: &Path, value: &str) -> Option<PathBuf> {
    let relative = Path::new(value);
    if relative.components().count() != 1
        || !matches!(
            relative.components().next(),
            Some(std::path::Component::Normal(_))
        )
    {
        return None;
    }
    Some(root.join(relative))
}

fn manifest_path(directory: &Path, enabled: bool) -> PathBuf {
    directory.join(if enabled {
        ACTIVE_MANIFEST
    } else {
        DISABLED_MANIFEST
    })
}

pub(super) fn skill_exists(root: &Path, installed: &InstalledSkill) -> bool {
    installed_path(root, &installed.directory).is_some_and(|directory| {
        manifest_path(&directory, true).is_file() || manifest_path(&directory, false).is_file()
    })
}

pub(super) fn set_directory_enabled(directory: &Path, enabled: bool) -> Result<(), String> {
    let source = manifest_path(directory, !enabled);
    let destination = manifest_path(directory, enabled);
    if destination.is_file() {
        if source.is_file() {
            return Err("The plugin status is inconsistent. Delete and reinstall it.".to_string());
        }
        return Ok(());
    }
    if !source.is_file() {
        return Err(
            "The installed plugin files could not be found. Refresh the list and try again."
                .to_string(),
        );
    }
    fs::rename(source, destination)
        .map_err(|error| format!("Could not update the installed plugin status: {error}"))
}

pub(super) fn mark_installed(
    home: &SkillHome,
    items: &mut [SkillMarketItem],
) -> Result<(), String> {
    let root = &home.root;
    let mut registry = home.read().map_err(|error| error.to_string())?;
    registry
        .installed
        .retain(|_, installed| skill_exists(root, installed));
    for installed in registry.installed.values_mut() {
        let Some(directory) = installed_path(root, &installed.directory) else {
            continue;
        };
        installed.enabled = manifest_path(&directory, true).is_file();
    }
    for item in items {
        let installed = registry.installed.get(&item.id);
        item.installed_version = installed.map(|value| value.version.clone());
        item.installed = item.installed_version.as_deref() == Some(item.version.as_str());
        item.enabled = installed.is_some_and(|value| value.enabled);
    }
    home.write(&registry).map_err(|error| error.to_string())
}

pub(super) fn set_market_skill_enabled(
    home: &SkillHome,
    skill_id: &str,
    enabled: bool,
) -> Result<(), String> {
    let root = &home.root;
    let mut registry = home.read().map_err(|error| error.to_string())?;
    let installed = registry
        .installed
        .get_mut(skill_id)
        .ok_or_else(|| "Install this plugin before changing whether it is enabled.".to_string())?;
    let directory = installed_path(root, &installed.directory).ok_or_else(|| {
        "The installed plugin path is invalid. Delete and reinstall it.".to_string()
    })?;
    let previous = installed.enabled;
    set_directory_enabled(&directory, enabled)?;
    installed.enabled = enabled;
    if let Err(error) = home.write(&registry).map_err(|error| error.to_string()) {
        set_directory_enabled(&directory, previous).map_err(|rollback| {
            format!("{error} The previous status could not be restored: {rollback}")
        })?;
        return Err(error);
    }
    Ok(())
}

pub(super) fn remove_market_skill(home: &SkillHome, skill_id: &str) -> Result<(), String> {
    let root = &home.root;
    let mut registry = home.read().map_err(|error| error.to_string())?;
    let installed = registry.installed.get(skill_id).ok_or_else(|| {
        "This plugin is not installed. Refresh the list and try again.".to_string()
    })?;
    let directory = installed_path(root, &installed.directory).ok_or_else(|| {
        "The installed plugin path is invalid. Refresh the list and try again.".to_string()
    })?;
    let temporary = root.join(format!(".codex-switch-skill-remove-{}", Uuid::new_v4()));
    let existed = directory.exists();
    if existed {
        fs::rename(&directory, &temporary).map_err(|error| {
            format!("Could not prepare the installed plugin for deletion: {error}")
        })?;
    }
    registry.installed.remove(skill_id);
    if let Err(error) = home.write(&registry).map_err(|error| error.to_string()) {
        if existed {
            fs::rename(&temporary, &directory).map_err(|rollback| {
                format!("{error} The plugin files could not be restored: {rollback}")
            })?;
        }
        return Err(error);
    }
    if existed {
        fs::remove_dir_all(&temporary).map_err(|error| {
            format!("The plugin was removed, but its files could not be deleted: {error}")
        })?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_installs_are_enabled_by_default() {
        let registry: SkillInstallRegistry = serde_json::from_str(
            r#"{"installed":{"demo":{"directory":"market-demo","version":"1.0.0"}}}"#,
        )
        .unwrap();

        assert!(registry.installed["demo"].enabled);
    }

    #[test]
    fn toggles_the_manifest_name() {
        let directory =
            std::env::temp_dir().join(format!("codex-switch-skill-test-{}", Uuid::new_v4()));
        fs::create_dir(&directory).unwrap();
        fs::write(directory.join(ACTIVE_MANIFEST), "test").unwrap();

        set_directory_enabled(&directory, false).unwrap();
        assert!(directory.join(DISABLED_MANIFEST).is_file());
        set_directory_enabled(&directory, true).unwrap();
        assert!(directory.join(ACTIVE_MANIFEST).is_file());

        fs::remove_dir_all(directory).unwrap();
    }
}
