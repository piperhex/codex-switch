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
    let base_url =
        crate::local_proxy::gui_runtime::ensure_started(app).map_err(|_| GuiError::Startup)?;
    prepare_from(&source.codex_home, &target, &base_url)?;
    Ok(target)
}

pub(super) fn prepare_from(source: &Path, target: &Path, base_url: &str) -> Result<()> {
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
    prepare_config(&source, &target, base_url)?;
    Ok(())
}

fn prepare_config(source: &Path, target: &Path, base_url: &str) -> Result<()> {
    // Import once; subsequent connections preserve edits made to the GUI's own configuration.
    let config = match read_optional(&target.join("config.toml"))? {
        Some(config) => config,
        None => read_optional(&source.join("config.toml"))?.unwrap_or_default(),
    };
    let config = isolated_config(&config, target, base_url)?;
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

fn isolated_config(config: &str, target: &Path, base_url: &str) -> Result<String> {
    let mut document = config
        .parse::<DocumentMut>()
        .map_err(|_| GuiError::Startup)?;
    document["sqlite_home"] = value(target.to_string_lossy().as_ref());
    document["log_dir"] = value(target.join("log").to_string_lossy().as_ref());
    document["cli_auth_credentials_store"] = value("file");
    configure_gui_proxy(&mut document, base_url)?;
    Ok(document.to_string())
}

/// Naming uses only the GUI model route, without user MCP servers, plugins or project instructions.
pub(super) fn prepare_title_home(gui_home: &Path, base_url: &str) -> Result<PathBuf> {
    let target = gui_home.join("title-generator");
    fs::create_dir_all(&target).map_err(|_| GuiError::Startup)?;
    let mut config = isolated_config("", &target, base_url)?
        .parse::<DocumentMut>()
        .map_err(|_| GuiError::Startup)?;
    config["model_providers"][GUI_PROVIDER_ID]["http_headers"]
        [crate::codex_config::LOCAL_PROXY_REQUEST_PURPOSE_HEADER] =
        value(crate::codex_config::TITLE_GENERATION_REQUEST_PURPOSE);
    crate::storage::write_text_if_changed(&target.join("config.toml"), &config.to_string())
        .map_err(|_| GuiError::Startup)?;
    Ok(target)
}

fn configure_gui_proxy(document: &mut DocumentMut, base_url: &str) -> Result<()> {
    use toml_edit::{Item, Table};
    document["model_provider"] = value(GUI_PROVIDER_ID);
    // A shared catalog may describe a different account or fixed Provider model.
    document.remove("model_catalog_json");
    let mut provider = Table::new();
    provider["name"] = value("Codex GUI");
    provider["base_url"] = value(base_url);
    provider["wire_api"] = value("responses");
    provider["requires_openai_auth"] = value(false);
    provider["experimental_bearer_token"] = value(crate::codex_config::LOCAL_PROXY_TOKEN);
    provider["http_headers"] = Item::Value(toml_edit::Value::InlineTable(
        crate::codex_config::proxy_headers(),
    ));
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

#[cfg(test)]
mod tests {
    use super::isolated_config;
    use crate::codex_config::{LOCAL_PROXY_ACTOR_AUTHORIZATION_HEADER, LOCAL_PROXY_TOKEN};
    use toml_edit::DocumentMut;

    #[test]
    fn repairs_existing_gui_provider_without_changing_model_or_routing() {
        let previous = r#"
model = "saved-model"
[model_providers.codex-switch-gui]
name = "Codex GUI"
base_url = "http://127.0.0.1:15722/codex-gui/v1"
requires_openai_auth = false
"#;
        let root = std::env::temp_dir();
        let base_url = "http://127.0.0.1:54321/codex-gui/v1";
        let repaired = isolated_config(previous, &root, base_url).unwrap();
        let document: DocumentMut = repaired.parse().unwrap();
        let provider = &document["model_providers"]["codex-switch-gui"];
        assert_eq!(document["model"].as_str(), Some("saved-model"));
        assert_eq!(
            document["model_provider"].as_str(),
            Some("codex-switch-gui")
        );
        assert_eq!(
            provider["http_headers"][LOCAL_PROXY_ACTOR_AUTHORIZATION_HEADER].as_str(),
            Some(LOCAL_PROXY_TOKEN)
        );
        assert_eq!(provider["requires_openai_auth"].as_bool(), Some(false));
        assert_eq!(provider["base_url"].as_str(), Some(base_url));
        assert_eq!(
            isolated_config(&repaired, &root, base_url).unwrap(),
            repaired
        );
    }
}
