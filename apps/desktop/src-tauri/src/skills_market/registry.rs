use std::{
    fs,
    path::{Path, PathBuf},
};

use sha2::{Digest, Sha256};
use tauri::{Manager, Runtime};

use super::installed::SkillInstallRegistry;

const LEGACY_REGISTRY: &str = "skill-market-installs.json";
const HOME_REGISTRIES: &str = "skill-market-installs";

#[derive(Debug, thiserror::Error)]
pub(super) enum RegistryError {
    #[error("无法打开所选 Codex Home，请重新选择。")]
    Home,
    #[error("无法读取插件安装记录，请重试。")]
    Read,
    #[error("无法保存插件安装记录，请重试。")]
    Write,
}

/// The directory and registry are resolved together so every operation targets one home.
pub(super) struct SkillHome {
    pub(super) root: PathBuf,
    registry: PathBuf,
}

impl SkillHome {
    pub(super) fn resolve<R: Runtime>(
        app: &tauri::AppHandle<R>,
        home_id: Option<&str>,
    ) -> Result<Self, RegistryError> {
        let home =
            crate::codex_home::resolve_selected(app, home_id).map_err(|_| RegistryError::Home)?;
        let primary = crate::codex_home::resolve().map_err(|_| RegistryError::Home)?;
        let data = app.path().app_data_dir().map_err(|_| RegistryError::Home)?;
        migrate_legacy(&data, &primary)?;
        Ok(Self {
            root: home.join("skills"),
            registry: registry_path(&data, &home),
        })
    }

    pub(super) fn read(&self) -> Result<SkillInstallRegistry, RegistryError> {
        match fs::read(&self.registry) {
            Ok(data) => serde_json::from_slice(&data).map_err(|_| RegistryError::Read),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                Ok(SkillInstallRegistry::default())
            }
            Err(_) => Err(RegistryError::Read),
        }
    }

    pub(super) fn write(&self, registry: &SkillInstallRegistry) -> Result<(), RegistryError> {
        let parent = self.registry.parent().ok_or(RegistryError::Write)?;
        fs::create_dir_all(parent).map_err(|_| RegistryError::Write)?;
        let value = serde_json::to_value(registry).map_err(|_| RegistryError::Write)?;
        crate::storage::write_json_atomic(&self.registry, &value).map_err(|_| RegistryError::Write)
    }
}

fn registry_path(data: &Path, home: &Path) -> PathBuf {
    let normalized = home.to_string_lossy().replace('\\', "/");
    let normalized = normalized.trim_end_matches('/');
    // Windows paths are case insensitive, including paths that do not exist yet.
    let key = if cfg!(windows) {
        normalized.to_lowercase()
    } else {
        normalized.to_string()
    };
    data.join(HOME_REGISTRIES)
        .join(format!("{:x}.json", Sha256::digest(key.as_bytes())))
}

fn migrate_legacy(data: &Path, primary: &Path) -> Result<(), RegistryError> {
    let legacy = data.join(LEGACY_REGISTRY);
    if !legacy.exists() {
        return Ok(());
    }
    fs::create_dir_all(data.join(HOME_REGISTRIES)).map_err(|_| RegistryError::Write)?;
    let destination = registry_path(data, primary);
    // Bind the old shared registry to the home it managed before home selection was introduced.
    // Preserve an existing scoped registry if a prior migration already created one.
    let destination = if destination.exists() {
        data.join(HOME_REGISTRIES).join("legacy-backup.json")
    } else {
        destination
    };
    fs::rename(legacy, destination).map_err(|_| RegistryError::Write)
}

#[cfg(test)]
mod tests;
