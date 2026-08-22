use std::{
    fs, io,
    path::{Path, PathBuf},
};

use toml_edit::{value, DocumentMut};

use super::{catalog, repository, PluginManifest};

const LOCAL_VERSION: &str = "local";

pub(super) fn install(codex_home: &Path, plugin_id: &str) -> Result<(), String> {
    let (name, marketplace) = validated_plugin_id(plugin_id)?;
    let repository = repository::ensure_snapshot(codex_home)?;
    if !catalog::contains_plugin(&repository, marketplace, name) {
        return Err(
            "This official plugin is no longer available. Refresh the catalog and try again."
                .to_string(),
        );
    }
    let source = catalog::plugin_source(&repository, name);
    let manifest = read_manifest(&source)?;
    if manifest.name.as_deref() != Some(name) {
        return Err(
            "The official plugin package is invalid. Refresh the catalog and try again."
                .to_string(),
        );
    }
    let version = install_version(codex_home, manifest.version.as_deref())?;
    let target = plugin_cache_root(codex_home, marketplace, name);
    replace_plugin_root(&source, &target, &version)?;
    update_plugin_enabled(codex_home, plugin_id, true)
}

pub(super) fn remove(codex_home: &Path, plugin_id: &str) -> Result<(), String> {
    let (name, marketplace) = validated_plugin_id(plugin_id)?;
    let target = plugin_cache_root(codex_home, marketplace, name);
    match fs::remove_dir_all(&target) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(_) => {
            return Err("The official plugin could not be removed. Please try again.".to_string())
        }
    }
    clear_plugin_config(codex_home, plugin_id)
}

pub(super) fn set_enabled(codex_home: &Path, plugin_id: &str, enabled: bool) -> Result<(), String> {
    let (name, marketplace) = validated_plugin_id(plugin_id)?;
    if !plugin_cache_root(codex_home, marketplace, name).is_dir() {
        return Err("Install this plugin before changing its status.".to_string());
    }
    update_plugin_enabled(codex_home, plugin_id, enabled)
}

fn validated_plugin_id(plugin_id: &str) -> Result<(&str, &str), String> {
    catalog::validate_plugin_id(plugin_id).ok_or_else(|| {
        "This official plugin selection is invalid. Refresh the catalog and try again.".to_string()
    })
}

fn plugin_cache_root(codex_home: &Path, marketplace: &str, name: &str) -> PathBuf {
    codex_home
        .join("plugins/cache")
        .join(marketplace)
        .join(name)
}

fn read_manifest(source: &Path) -> Result<PluginManifest, String> {
    let bytes = fs::read(source.join(".codex-plugin/plugin.json")).map_err(|_| {
        "The official plugin package is incomplete. Refresh the catalog and try again.".to_string()
    })?;
    serde_json::from_slice(&bytes).map_err(|_| {
        "The official plugin package is invalid. Refresh the catalog and try again.".to_string()
    })
}

fn install_version(codex_home: &Path, manifest_version: Option<&str>) -> Result<String, String> {
    let snapshot_version = fs::read_to_string(codex_home.join(".tmp/plugins.sha"))
        .ok()
        .map(|value| value.trim().chars().take(8).collect::<String>())
        .filter(|value| !value.is_empty());
    let version = snapshot_version
        .or_else(|| manifest_version.map(str::to_string))
        .unwrap_or_else(|| LOCAL_VERSION.to_string());
    if version.chars().all(is_safe_version_character) && !matches!(version.as_str(), "." | "..") {
        return Ok(version);
    }
    Err("The official plugin version is invalid. Refresh the catalog and try again.".to_string())
}

fn is_safe_version_character(character: char) -> bool {
    character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.' | '+')
}

fn replace_plugin_root(source: &Path, target: &Path, version: &str) -> Result<(), String> {
    let parent = target
        .parent()
        .ok_or_else(|| "The official plugin install path is invalid.".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|_| "The official plugin could not be installed. Please try again.".to_string())?;
    let staging = parent.join(format!("plugin-install-{}", std::process::id()));
    let backup = parent.join(format!("plugin-backup-{}", std::process::id()));
    remove_temporary_path(&staging)?;
    remove_temporary_path(&backup)?;
    let staged_root = staging.join(version);
    if let Err(error) = copy_dir_recursive(source, &staged_root) {
        return match remove_temporary_path(&staging) {
            Ok(()) => Err(error),
            Err(_) => Err(format!("{error} Please try again.")),
        };
    }

    let had_existing = target.exists();
    if had_existing {
        fs::rename(target, &backup).map_err(|_| {
            "The existing plugin could not be updated. Please try again.".to_string()
        })?;
    }
    if let Err(error) = fs::rename(&staging, target) {
        if had_existing {
            if let Err(rollback) = fs::rename(&backup, target) {
                return Err(format!(
                    "The official plugin could not be installed: {error}. The previous version could not be restored: {rollback}"
                ));
            }
        }
        return Err(format!(
            "The official plugin could not be installed: {error}"
        ));
    }
    if had_existing {
        fs::remove_dir_all(&backup).map_err(|_| {
            "The plugin was updated, but its old version could not be removed.".to_string()
        })?;
    }
    Ok(())
}

fn remove_temporary_path(path: &Path) -> Result<(), String> {
    match fs::remove_dir_all(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(_) => {
            Err("The official plugin installation workspace could not be prepared.".to_string())
        }
    }
}

fn copy_dir_recursive(source: &Path, target: &Path) -> Result<(), String> {
    fs::create_dir_all(target)
        .map_err(|_| "The official plugin files could not be copied.".to_string())?;
    let entries = fs::read_dir(source)
        .map_err(|_| "The official plugin package could not be read.".to_string())?;
    for entry in entries {
        let entry =
            entry.map_err(|_| "The official plugin package could not be read.".to_string())?;
        let kind = entry
            .file_type()
            .map_err(|_| "The official plugin package could not be inspected.".to_string())?;
        let destination = target.join(entry.file_name());
        if kind.is_dir() {
            copy_dir_recursive(&entry.path(), &destination)?;
        } else if kind.is_file() {
            fs::copy(entry.path(), destination)
                .map_err(|_| "The official plugin files could not be copied.".to_string())?;
        } else {
            return Err("The official plugin package contains an unsupported file.".to_string());
        }
    }
    Ok(())
}

pub(super) fn update_plugin_enabled_text(
    config: &str,
    plugin_id: &str,
    enabled: bool,
) -> Result<String, String> {
    let mut document = parse_config(config)?;
    document["plugins"][plugin_id]["enabled"] = value(enabled);
    Ok(document.to_string())
}

fn clear_plugin_config(codex_home: &Path, plugin_id: &str) -> Result<(), String> {
    let current = read_config(codex_home)?;
    let mut document = parse_config(&current)?;
    if let Some(plugins) = document["plugins"].as_table_like_mut() {
        plugins.remove(plugin_id);
    }
    write_config(codex_home, &document.to_string())
}

fn update_plugin_enabled(codex_home: &Path, plugin_id: &str, enabled: bool) -> Result<(), String> {
    let current = read_config(codex_home)?;
    let updated = update_plugin_enabled_text(&current, plugin_id, enabled)?;
    write_config(codex_home, &updated)
}

fn parse_config(config: &str) -> Result<DocumentMut, String> {
    config.parse::<DocumentMut>().map_err(|_| {
        "The Codex plugin setting could not be read. Check your Codex settings and try again."
            .to_string()
    })
}

fn read_config(codex_home: &Path) -> Result<String, String> {
    match fs::read_to_string(codex_home.join("config.toml")) {
        Ok(config) => Ok(config),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(String::new()),
        Err(_) => Err("The Codex plugin setting could not be read. Please try again.".to_string()),
    }
}

fn write_config(codex_home: &Path, config: &str) -> Result<(), String> {
    crate::storage::write_text_atomic(&codex_home.join("config.toml"), config)
        .map_err(|_| "The Codex plugin setting could not be saved. Please try again.".to_string())
}
