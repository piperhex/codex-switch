use std::{
    path::{Path, PathBuf},
    sync::OnceLock,
};

use tauri::Runtime;

use super::{current_overrides, gui_home, paths_match, ConfiguredCodexHome};

const CODEX_HOME_ENV: &str = "CODEX_HOME";
const DEFAULT_CODEX_HOME_DIRECTORY: &str = ".codex";

// Set once by application startup, before settings migration or any home resolution.
static GUI_HOME: OnceLock<PathBuf> = OnceLock::new();

/// Identify the private GUI home before interpreting an inherited CODEX_HOME.
pub(crate) fn initialize_paths<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<(), String> {
    let path = gui_home(app)?;
    if GUI_HOME.get_or_init(|| path.clone()) != &path {
        return Err("Codex Home 初始化失败，请重启应用。".to_string());
    }
    Ok(())
}

fn environment_codex_home() -> Option<PathBuf> {
    std::env::var_os(CODEX_HOME_ENV)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

fn resolve_from_sources(
    configured: Option<PathBuf>,
    environment: Option<PathBuf>,
    home: Option<PathBuf>,
    built_in_home: Option<&Path>,
) -> Result<PathBuf, String> {
    // A Switch launched by the built-in agent inherits its private CODEX_HOME.
    // Treating that as the external default lets GUI deduplication erase the default entry.
    let environment = environment
        .filter(|path| !built_in_home.is_some_and(|built_in| paths_match(path, built_in)));
    configured
        .or(environment)
        .or_else(|| home.map(|path| path.join(DEFAULT_CODEX_HOME_DIRECTORY)))
        .ok_or_else(|| "无法定位用户 Home 目录".to_string())
}

pub(crate) fn resolve() -> Result<PathBuf, String> {
    let configured = current_overrides();
    resolve_for_override(configured.first().map(|entry| entry.path.as_path()))
}

pub(crate) fn resolve_default() -> Result<PathBuf, String> {
    resolve_for_override(None)
}

pub(crate) fn resolve_all() -> Result<Vec<ConfiguredCodexHome>, String> {
    let configured = current_overrides();
    if !configured.is_empty() {
        return Ok(configured);
    }
    Ok(vec![ConfiguredCodexHome {
        id: None,
        path: resolve_default()?,
    }])
}

pub(super) fn resolve_for_override(value: Option<&Path>) -> Result<PathBuf, String> {
    resolve_from_sources(
        value.map(Path::to_path_buf),
        environment_codex_home(),
        dirs::home_dir(),
        GUI_HOME.get().map(PathBuf::as_path),
    )
}

#[cfg(test)]
mod startup_tests;
#[cfg(test)]
mod tests;
