use super::error::{GuiError, Result};
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::AppHandle;
use toml_edit::{value, DocumentMut};

const GUI_PROVIDER_ID: &str = "codex-switch-gui";

/// Older conversations can contain the shared provider; always resume them on the GUI route.
pub(super) fn scope_thread_request(method: &str, params: &mut serde_json::Value) {
    if matches!(method, "thread/start" | "thread/resume" | "thread/fork") {
        params["modelProvider"] = serde_json::json!(GUI_PROVIDER_ID);
    }
}

/// Import initial preferences while keeping GUI authentication and routing independent.
pub(super) fn prepare(app: &AppHandle) -> Result<PathBuf> {
    let source = crate::storage::resolve_paths(app).map_err(|_| GuiError::Startup)?;
    let target = crate::codex_home::gui_home(app).map_err(|_| GuiError::Startup)?;
    super::account_selection::read(app).map_err(|_| GuiError::Startup)?;
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
    prepare_config(&source, &target)?;
    Ok(())
}

fn prepare_config(source: &Path, target: &Path) -> Result<()> {
    // Import once; subsequent connections preserve edits made to the GUI's own configuration.
    let config = match read_optional(&target.join("config.toml"))? {
        Some(config) => config,
        None => read_optional(&source.join("config.toml"))?.unwrap_or_default(),
    };
    let config = isolated_config(&config, target)?;
    crate::storage::write_text_if_changed(&target.join("config.toml"), &config)
        .map_err(|_| GuiError::Startup)?;
    Ok(())
}

fn read_optional(path: &Path) -> Result<Option<String>> {
    match fs::read_to_string(path) {
        Ok(content) => Ok(Some(content)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err(GuiError::Startup),
    }
}

fn isolated_config(config: &str, target: &Path) -> Result<String> {
    let mut document = config
        .parse::<DocumentMut>()
        .map_err(|_| GuiError::Startup)?;
    document["sqlite_home"] = value(target.to_string_lossy().as_ref());
    document["log_dir"] = value(target.join("log").to_string_lossy().as_ref());
    document["cli_auth_credentials_store"] = value("file");
    configure_gui_proxy(&mut document)?;
    Ok(document.to_string())
}

fn configure_gui_proxy(document: &mut DocumentMut) -> Result<()> {
    use toml_edit::{Item, Table};
    document["model_provider"] = value(GUI_PROVIDER_ID);
    // A shared catalog may describe a different account or fixed Provider model.
    document.remove("model_catalog_json");
    let mut provider = Table::new();
    provider["name"] = value("Codex GUI");
    provider["base_url"] = value(format!(
        "http://{}:{}/codex-gui/v1",
        crate::codex_config::LOCAL_PROXY_HOST,
        crate::codex_config::LOCAL_PROXY_PORT,
    ));
    provider["wire_api"] = value("responses");
    provider["requires_openai_auth"] = value(false);
    provider["experimental_bearer_token"] = value(crate::codex_config::LOCAL_PROXY_TOKEN);
    provider["supports_websockets"] = value(false);
    if !document.contains_key("model_providers") {
        document["model_providers"] = Item::Table(Table::new());
    }
    document["model_providers"]
        .as_table_mut()
        .ok_or(GuiError::Startup)?
        .insert(GUI_PROVIDER_ID, Item::Table(provider));
    Ok(())
}
