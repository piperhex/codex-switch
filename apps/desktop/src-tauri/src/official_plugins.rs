use std::{
    path::Path,
    sync::{Mutex, MutexGuard},
};

use serde::Serialize;

mod catalog;
mod repository;
mod store;

const OFFICIAL_MARKETPLACES: &[&str] = &["openai-api-curated", "openai-curated"];
static OFFICIAL_PLUGIN_LOCK: Mutex<()> = Mutex::new(());

fn lock_official_plugins(lock: &Mutex<()>) -> MutexGuard<'_, ()> {
    match lock.lock() {
        Ok(guard) => guard,
        Err(poisoned) => {
            eprintln!(
                "official plugin lock was poisoned; recovering so plugin operations can continue"
            );
            poisoned.into_inner()
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OfficialPluginItem {
    id: String,
    name: String,
    title: String,
    description: String,
    version: String,
    category: String,
    developer: String,
    brand_color: Option<String>,
    icon_url: Option<String>,
    installed: bool,
    enabled: bool,
}

#[derive(Debug, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct PluginManifest {
    pub(super) name: Option<String>,
    pub(super) version: Option<String>,
    pub(super) description: Option<String>,
    pub(super) author: Option<ManifestAuthor>,
    pub(super) interface: Option<PluginInterface>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(untagged)]
pub(super) enum ManifestAuthor {
    Name(String),
    Detail { name: String },
}

impl ManifestAuthor {
    pub(super) fn name(&self) -> &str {
        match self {
            Self::Name(name) | Self::Detail { name } => name,
        }
    }
}

#[derive(Debug, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct PluginInterface {
    #[serde(rename = "displayName")]
    pub(super) display_name: Option<String>,
    #[serde(rename = "shortDescription")]
    pub(super) short_description: Option<String>,
    #[serde(rename = "developerName")]
    pub(super) developer_name: Option<String>,
    pub(super) category: Option<String>,
    #[serde(rename = "brandColor")]
    pub(super) brand_color: Option<String>,
    pub(super) logo: Option<String>,
    #[serde(rename = "composerIcon")]
    pub(super) composer_icon: Option<String>,
}

fn list_official_plugins_blocking(codex_home: &Path) -> Result<Vec<OfficialPluginItem>, String> {
    let _guard = lock_official_plugins(&OFFICIAL_PLUGIN_LOCK);
    catalog::list(codex_home)
}

fn install_official_plugin_blocking(codex_home: &Path, plugin_id: &str) -> Result<(), String> {
    let _guard = lock_official_plugins(&OFFICIAL_PLUGIN_LOCK);
    store::install(codex_home, plugin_id)
}

fn remove_official_plugin_blocking(codex_home: &Path, plugin_id: &str) -> Result<(), String> {
    let _guard = lock_official_plugins(&OFFICIAL_PLUGIN_LOCK);
    store::remove(codex_home, plugin_id)
}

fn set_official_plugin_enabled_blocking(
    codex_home: &Path,
    plugin_id: &str,
    enabled: bool,
) -> Result<(), String> {
    let _guard = lock_official_plugins(&OFFICIAL_PLUGIN_LOCK);
    store::set_enabled(codex_home, plugin_id, enabled)
}

#[tauri::command]
pub(crate) async fn list_official_plugins(
    app: tauri::AppHandle,
) -> Result<Vec<OfficialPluginItem>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let codex_home = crate::storage::resolve_paths(&app)?.codex_home;
        list_official_plugins_blocking(&codex_home)
    })
    .await
    .map_err(|_| "The official plugin catalog stopped loading. Please try again.".to_string())?
}

#[tauri::command]
pub(crate) async fn install_official_plugin(
    app: tauri::AppHandle,
    plugin_id: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let codex_home = crate::storage::resolve_paths(&app)?.codex_home;
        install_official_plugin_blocking(&codex_home, &plugin_id)
    })
    .await
    .map_err(|_| "The official plugin installation stopped. Please try again.".to_string())?
}

#[tauri::command]
pub(crate) async fn remove_official_plugin(
    app: tauri::AppHandle,
    plugin_id: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let codex_home = crate::storage::resolve_paths(&app)?.codex_home;
        remove_official_plugin_blocking(&codex_home, &plugin_id)
    })
    .await
    .map_err(|_| "The official plugin uninstall stopped. Please try again.".to_string())?
}

#[tauri::command]
pub(crate) async fn set_official_plugin_enabled(
    app: tauri::AppHandle,
    plugin_id: String,
    enabled: bool,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let codex_home = crate::storage::resolve_paths(&app)?.codex_home;
        set_official_plugin_enabled_blocking(&codex_home, &plugin_id, enabled)
    })
    .await
    .map_err(|_| "The official plugin setting stopped updating. Please try again.".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recovers_from_a_poisoned_plugin_lock() {
        let lock = Mutex::new(());
        let panic_result = std::panic::catch_unwind(|| {
            let _guard = lock.lock().expect("test lock should be available");
            panic!("simulate a failed plugin operation");
        });

        assert!(panic_result.is_err());
        let _guard = lock_official_plugins(&lock);
    }

    #[test]
    fn accepts_only_official_plugin_ids() {
        assert_eq!(
            catalog::validate_plugin_id("build-web-apps@openai-api-curated"),
            Some(("build-web-apps", "openai-api-curated"))
        );
        assert_eq!(catalog::validate_plugin_id("demo@community"), None);
        assert_eq!(catalog::validate_plugin_id("../demo@openai-curated"), None);
    }

    #[test]
    fn builds_only_safe_official_asset_urls() {
        assert_eq!(
            catalog::official_asset_url("linear", Some("./assets/icon.svg")),
            Some(
                "https://raw.githubusercontent.com/openai/plugins/main/plugins/linear/assets/icon.svg"
                    .to_string()
            )
        );
        assert_eq!(
            catalog::official_asset_url("linear", Some("../secret")),
            None
        );
        assert_eq!(
            catalog::official_asset_url("linear", Some("C:\\secret")),
            None
        );
    }

    #[test]
    fn updates_only_the_selected_plugin_state() {
        let config = r#"model = "gpt-5"

[plugins."gmail@openai-curated"]
enabled = true

[plugins."browser@openai-bundled"]
enabled = true
"#;
        let updated =
            store::update_plugin_enabled_text(config, "gmail@openai-curated", false).unwrap();
        let document = updated.parse::<toml_edit::DocumentMut>().unwrap();

        assert_eq!(document["model"].as_str(), Some("gpt-5"));
        assert_eq!(
            document["plugins"]["gmail@openai-curated"]["enabled"].as_bool(),
            Some(false)
        );
        assert_eq!(
            document["plugins"]["browser@openai-bundled"]["enabled"].as_bool(),
            Some(true)
        );
    }

    #[test]
    fn creates_plugin_state_in_an_empty_config() {
        let updated = store::update_plugin_enabled_text("", "gmail@openai-curated", true).unwrap();
        let document = updated.parse::<toml_edit::DocumentMut>().unwrap();

        assert_eq!(
            document["plugins"]["gmail@openai-curated"]["enabled"].as_bool(),
            Some(true)
        );
    }

    #[test]
    fn reads_the_api_curated_catalog_without_the_codex_cli() {
        let root = std::env::temp_dir().join(format!(
            "codex-switch-official-plugin-test-{}",
            std::process::id()
        ));
        if root.exists() {
            std::fs::remove_dir_all(&root).unwrap();
        }
        let repository = root.join(".tmp/plugins");
        std::fs::create_dir_all(repository.join(".agents/plugins")).unwrap();
        std::fs::create_dir_all(repository.join("plugins/demo/.codex-plugin")).unwrap();
        std::fs::write(
            repository.join(".agents/plugins/api_marketplace.json"),
            r#"{"name":"openai-api-curated","plugins":[{"name":"demo","category":"Developer Tools"}]}"#,
        )
        .unwrap();
        std::fs::write(
            repository.join("plugins/demo/.codex-plugin/plugin.json"),
            r#"{"name":"demo","version":"1.2.3","interface":{"displayName":"Demo","shortDescription":"Demo plugin"}}"#,
        )
        .unwrap();

        let items = catalog::list(&root).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].id, "demo@openai-api-curated");
        assert_eq!(items[0].title, "Demo");
        assert!(!items[0].installed);
        std::fs::remove_dir_all(root).unwrap();
    }
}
