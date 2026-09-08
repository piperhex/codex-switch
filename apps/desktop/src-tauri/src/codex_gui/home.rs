use super::error::{GuiError, Result};
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager};
use toml_edit::{value, DocumentMut};

/// Only configuration and authentication are imported. Rollouts, databases, indexes and logs
/// always belong to the application's private Codex home.
pub(super) fn prepare(app: &AppHandle) -> Result<PathBuf> {
    let source = crate::storage::resolve_paths(app).map_err(|_| GuiError::Startup)?;
    let target = app
        .path()
        .app_data_dir()
        .map_err(|_| GuiError::Startup)?
        .join(".codex");
    prepare_from(&source.codex_home, &target)?;
    Ok(target)
}

pub(super) fn prepare_from(source: &Path, target: &Path) -> Result<()> {
    fs::create_dir_all(target).map_err(|_| GuiError::Startup)?;
    if !source.is_absolute() {
        return Err(GuiError::Startup);
    }
    let source = if source.exists() {
        source.canonicalize().map_err(|_| GuiError::Startup)?
    } else {
        source.to_path_buf()
    };
    let target = target.canonicalize().map_err(|_| GuiError::Startup)?;
    if source == target {
        return Err(GuiError::Startup);
    }
    let config = read_optional(&source.join("config.toml"))?.unwrap_or_default();
    let config = isolated_config(&config, &source, &target)?;
    crate::storage::write_text_if_changed(&target.join("config.toml"), &config)
        .map_err(|_| GuiError::Startup)?;
    let auth_path = target.join("auth.json");
    if let Some(auth) = read_optional(&source.join("auth.json"))? {
        crate::storage::write_text_if_changed(&auth_path, &auth).map_err(|_| GuiError::Startup)?;
        super::platform::protect_auth(&auth_path)?;
    } else if auth_path.exists() {
        // Do not silently retain credentials after the selected account has signed out.
        fs::remove_file(auth_path).map_err(|_| GuiError::Startup)?;
    }
    Ok(())
}

fn read_optional(path: &Path) -> Result<Option<String>> {
    match fs::read_to_string(path) {
        Ok(content) => Ok(Some(content)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err(GuiError::Startup),
    }
}

fn isolated_config(config: &str, source: &Path, target: &Path) -> Result<String> {
    let mut document = config
        .parse::<DocumentMut>()
        .map_err(|_| GuiError::Startup)?;
    document["sqlite_home"] = value(target.to_string_lossy().as_ref());
    document["log_dir"] = value(target.join("log").to_string_lossy().as_ref());
    document["cli_auth_credentials_store"] = value("file");
    if let Some(catalog) = document
        .get("model_catalog_json")
        .and_then(|item| item.as_str())
    {
        let path = Path::new(catalog);
        if path.is_relative() {
            document["model_catalog_json"] = value(source.join(path).to_string_lossy().as_ref());
        }
    }
    Ok(document.to_string())
}
