use serde::{Deserialize, Serialize};
use std::{fs, path::Path, sync::Mutex};
use tauri::{AppHandle, Manager, Runtime};

const FILE_NAME: &str = "codex-gui-account.json";
const CHANGED_EVENT: &str = "codex-gui-account-changed";
static SELECTION_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, thiserror::Error)]
pub(crate) enum SelectionError {
    #[error("暂时无法读取 Codex GUI 账户，请稍后重试。")]
    Storage,
    #[error("此账户已不可用，请重新选择。")]
    Unavailable,
}

/// GUI routing is persisted separately from the account manager's active target.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "id", rename_all = "camelCase")]
pub(crate) enum GuiAccountSelection {
    #[default]
    None,
    Account(String),
    Provider(String),
}

impl GuiAccountSelection {
    /// Adapt a disposable summary snapshot; never persist it as the manager's state.
    pub(crate) fn apply_to_summary(&self, state: &mut crate::models::ManagerStateFile) {
        state.active_account_id = None;
        state.active_provider_id = None;
        state.active_provider_group = None;
        state.concurrent_account_routing_enabled = false;
        match self {
            Self::Account(id) => state.active_account_id = Some(id.clone()),
            Self::Provider(id) => state.active_provider_id = Some(id.clone()),
            Self::None => {}
        }
    }
}

fn read_or_initialize(
    path: &Path,
    initial: impl FnOnce() -> Result<GuiAccountSelection, SelectionError>,
) -> Result<GuiAccountSelection, SelectionError> {
    match fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|_| SelectionError::Storage),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let selection = initial()?;
            save(path, &selection)?;
            Ok(selection)
        }
        Err(_) => Err(SelectionError::Storage),
    }
}

fn save(path: &Path, selection: &GuiAccountSelection) -> Result<(), SelectionError> {
    let value = serde_json::to_value(selection).map_err(|_| SelectionError::Storage)?;
    crate::storage::write_json_atomic(path, &value).map_err(|_| SelectionError::Storage)
}

/// Copy the previous selection once, then ignore changes to the shared switch state.
pub(crate) fn read<R: Runtime>(app: &AppHandle<R>) -> Result<GuiAccountSelection, SelectionError> {
    let _guard = SELECTION_LOCK.lock().map_err(|_| SelectionError::Storage)?;
    let root = app
        .path()
        .app_data_dir()
        .map_err(|_| SelectionError::Storage)?;
    read_or_initialize(&root.join(FILE_NAME), || {
        let paths = crate::storage::resolve_paths(app).map_err(|_| SelectionError::Storage)?;
        let state = crate::storage::try_read_state(&paths).map_err(|_| SelectionError::Storage)?;
        Ok(
            if let Some(id) = state
                .active_provider_id
                .filter(|id| !crate::aggregate_api::is_active_id(id))
            {
                GuiAccountSelection::Provider(id)
            } else if let Some(id) = state.active_account_id {
                GuiAccountSelection::Account(id)
            } else {
                GuiAccountSelection::None
            },
        )
    })
}

fn validate(app: &AppHandle, selection: &GuiAccountSelection) -> Result<(), SelectionError> {
    let paths = crate::storage::resolve_paths(app).map_err(|_| SelectionError::Storage)?;
    match selection {
        GuiAccountSelection::Account(id) => {
            // Resolve IDs from the managed catalog before constructing any credential path.
            let accounts = crate::commands::list_accounts_blocking(app.clone())
                .map_err(|_| SelectionError::Storage)?;
            if !accounts
                .iter()
                .any(|account| account.id == *id && account.local_proxy_compatible)
            {
                return Err(SelectionError::Unavailable);
            }
            crate::commands::load_validated_managed_auth(&paths, id)
                .map_err(|_| SelectionError::Unavailable)?;
        }
        GuiAccountSelection::Provider(id) => {
            let providers = crate::providers::list_providers_blocking(app.clone())
                .map_err(|_| SelectionError::Storage)?;
            if !providers.iter().any(|provider| provider.id == *id) {
                return Err(SelectionError::Unavailable);
            }
            let provider = crate::providers::read_provider(&paths, id)
                .map_err(|_| SelectionError::Unavailable)?;
            crate::providers::ensure_not_local_proxy_base_url(&provider.base_url)
                .map_err(|_| SelectionError::Unavailable)?;
        }
        GuiAccountSelection::None => return Err(SelectionError::Unavailable),
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn codex_gui_account_selection(
    app: AppHandle,
) -> Result<GuiAccountSelection, String> {
    tauri::async_runtime::spawn_blocking(move || read(&app))
        .await
        .map_err(|_| SelectionError::Storage.to_string())?
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn codex_gui_switch_account(
    app: AppHandle,
    selection: GuiAccountSelection,
) -> Result<GuiAccountSelection, String> {
    tauri::async_runtime::spawn_blocking(move || {
        validate(&app, &selection)?;
        let _guard = SELECTION_LOCK.lock().map_err(|_| SelectionError::Storage)?;
        let root = app
            .path()
            .app_data_dir()
            .map_err(|_| SelectionError::Storage)?;
        save(&root.join(FILE_NAME), &selection)?;
        crate::codex_gui::web::publish(&app, CHANGED_EVENT, &selection);
        Ok::<_, SelectionError>(selection)
    })
    .await
    .map_err(|_| SelectionError::Storage.to_string())?
    .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn summary_uses_gui_selection_without_shared_groups_or_concurrent_accounts() {
        let shared = crate::models::ManagerStateFile {
            active_account_id: Some("shared-account".into()),
            active_provider_id: Some("shared-provider".into()),
            active_provider_group: Some("shared-group".into()),
            concurrent_account_routing_enabled: true,
            ..Default::default()
        };
        let mut summary = shared.clone();
        GuiAccountSelection::Account("gui".into()).apply_to_summary(&mut summary);
        assert_eq!(summary.active_account_id.as_deref(), Some("gui"));
        assert!(summary.active_provider_id.is_none());
        assert!(summary.active_provider_group.is_none());
        assert!(!summary.concurrent_account_routing_enabled);
        GuiAccountSelection::Provider("gui-provider".into()).apply_to_summary(&mut summary);
        assert!(summary.active_account_id.is_none());
        assert_eq!(summary.active_provider_id.as_deref(), Some("gui-provider"));
        assert_eq!(shared.active_account_id.as_deref(), Some("shared-account"));
        assert!(shared.concurrent_account_routing_enabled);
    }

    #[test]
    fn selection_survives_shared_switches_and_restart() {
        let root = std::env::temp_dir().join(format!("gui-selection-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let path = root.join(FILE_NAME);
        let first = GuiAccountSelection::Account("first".into());
        assert_eq!(
            read_or_initialize(&path, || Ok(first.clone())).unwrap(),
            first
        );
        let second = GuiAccountSelection::Provider("second".into());
        save(&path, &second).unwrap();
        assert_eq!(
            read_or_initialize(&path, || panic!("must not read shared state")).unwrap(),
            second
        );
        fs::write(&path, "broken").unwrap();
        assert!(read_or_initialize(&path, || Ok(first)).is_err());
        fs::remove_file(path).unwrap();
        fs::remove_dir(root).unwrap();
    }
}
