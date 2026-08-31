use std::{
    fs,
    path::{Path, PathBuf},
    sync::{OnceLock, RwLock},
};

use tauri::{Emitter, Runtime};

use crate::{
    models::{AppSettings, ManagerStateFile},
    storage::{
        change_concurrent_account_routing, read_app_settings, resolve_paths,
        sync_current_into_store, try_read_state, write_app_settings, write_state, Paths,
    },
};

static CODEX_HOME_OVERRIDE: OnceLock<RwLock<Option<PathBuf>>> = OnceLock::new();

const CODEX_HOME_ENV: &str = "CODEX_HOME";
const DEFAULT_CODEX_HOME_DIRECTORY: &str = ".codex";
const HOME_CHANGE_EVENTS: [&str; 2] = ["accounts-changed", "providers-changed"];

fn override_store() -> &'static RwLock<Option<PathBuf>> {
    CODEX_HOME_OVERRIDE.get_or_init(|| RwLock::new(None))
}

fn is_safe_home_path(path: &Path) -> bool {
    path.is_absolute() && path.parent().is_some()
}

fn normalized_override(value: Option<&str>) -> Option<PathBuf> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .filter(|path| is_safe_home_path(path))
}

fn replace_override(value: Option<PathBuf>) {
    let mut configured = override_store()
        .write()
        .unwrap_or_else(|error| error.into_inner());
    *configured = value;
}

fn current_override() -> Option<PathBuf> {
    override_store()
        .read()
        .unwrap_or_else(|error| error.into_inner())
        .clone()
}

pub(crate) fn initialize(value: Option<&str>) {
    replace_override(normalized_override(value));
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
) -> Result<PathBuf, String> {
    configured
        .or(environment)
        .or_else(|| home.map(|path| path.join(DEFAULT_CODEX_HOME_DIRECTORY)))
        .ok_or_else(|| "无法定位用户 Home 目录".to_string())
}

pub(crate) fn resolve() -> Result<PathBuf, String> {
    resolve_from_sources(
        current_override(),
        environment_codex_home(),
        dirs::home_dir(),
    )
}

fn resolve_for_override(value: Option<&Path>) -> Result<PathBuf, String> {
    resolve_from_sources(
        value.map(Path::to_path_buf),
        environment_codex_home(),
        dirs::home_dir(),
    )
}

fn validate_custom_home(value: &str) -> Result<PathBuf, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err("请选择 Codex Home 文件夹".to_string());
    }
    let path = PathBuf::from(trimmed);
    if !path.is_absolute() {
        return Err("Codex Home 必须使用绝对路径".to_string());
    }
    if !is_safe_home_path(&path) {
        return Err("不能将文件系统根目录设为 Codex Home".to_string());
    }
    let metadata = fs::metadata(&path).map_err(|error| format!("无法访问所选文件夹：{error}"))?;
    if !metadata.is_dir() {
        return Err("所选 Codex Home 路径不是文件夹".to_string());
    }
    fs::read_dir(&path).map_err(|error| format!("无法读取所选文件夹：{error}"))?;
    Ok(path)
}

fn paths_match(left: &Path, right: &Path) -> bool {
    match (fs::canonicalize(left), fs::canonicalize(right)) {
        (Ok(left), Ok(right)) => left == right,
        _ => left == right,
    }
}

fn inactive_state(mut state: ManagerStateFile) -> ManagerStateFile {
    state.active_account_id = None;
    state.active_provider_id = None;
    state.active_provider_group = None;
    change_concurrent_account_routing(&mut state, false, "Codex Home change");
    state.local_proxy_enabled = false;
    state
}

fn remove_config_backup(paths: &Paths) -> Result<(), String> {
    match fs::remove_file(&paths.config_backup) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("无法清理旧的 Codex 配置备份：{error}")),
    }
}

fn prepare_home_change<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<ManagerStateFile, String> {
    crate::providers::cleanup_stale_local_proxy_config(app)?;
    let paths = resolve_paths(app)?;
    remove_config_backup(&paths)?;
    let state = try_read_state(&paths)?;
    write_state(&paths, &inactive_state(state.clone()))?;
    Ok(state)
}

fn restore_state_after_failed_save(paths: &Paths, state: &ManagerStateFile) {
    let mut state = state.clone();
    let enabled = state.concurrent_account_routing_enabled;
    change_concurrent_account_routing(&mut state, enabled, "Codex Home change rollback");
    if let Err(error) = write_state(paths, &state) {
        eprintln!("failed to restore Codex Home state after settings save error: {error}");
    }
}

fn refresh_selected_home<R: Runtime>(app: &tauri::AppHandle<R>) {
    if let Err(error) = crate::providers::cleanup_stale_local_proxy_config(app) {
        eprintln!("failed to clean the selected Codex Home config: {error}");
    }
    if let Err(error) = sync_current_into_store(app) {
        eprintln!("failed to import auth.json from the selected Codex Home: {error}");
    }
    for event in HOME_CHANGE_EVENTS {
        if let Err(error) = app.emit(event, ()) {
            eprintln!("failed to emit {event} after changing Codex Home: {error}");
        }
    }
    crate::system_tray::refresh_menu(app);
}

fn update_codex_home<R: Runtime>(
    app: &tauri::AppHandle<R>,
    requested_path: Option<String>,
) -> Result<AppSettings, String> {
    let requested = requested_path
        .as_deref()
        .map(validate_custom_home)
        .transpose()?;
    let _switch_guard = crate::commands::account_switch_lock()
        .lock()
        .map_err(|_| "Codex Home 设置锁不可用".to_string())?;
    let current_home = resolve()?;
    let next_home = resolve_for_override(requested.as_deref())?;
    let changed = !paths_match(&current_home, &next_home);
    if changed && crate::local_proxy::is_running() {
        return Err("请先停止本地代理，再更改 Codex Home".to_string());
    }
    let old_paths = resolve_paths(app)?;
    let previous_state = changed.then(|| prepare_home_change(app)).transpose()?;
    let mut settings = read_app_settings(app)?;
    settings.codex_home = requested
        .as_ref()
        .map(|path| path.as_os_str().to_string_lossy().into_owned());
    if let Err(error) = write_app_settings(app, &settings) {
        if let Some(state) = previous_state.as_ref() {
            restore_state_after_failed_save(&old_paths, state);
        }
        return Err(error);
    }

    replace_override(requested);
    if changed {
        refresh_selected_home(app);
    }
    Ok(settings)
}

#[tauri::command]
pub(crate) async fn set_codex_home<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    path: Option<String>,
) -> Result<AppSettings, String> {
    tauri::async_runtime::spawn_blocking(move || update_codex_home(&app, path))
        .await
        .map_err(|error| format!("Codex Home 设置任务失败：{error}"))?
}

#[cfg(test)]
mod tests {
    use super::{resolve_from_sources, validate_custom_home};
    use std::{fs, path::PathBuf};

    #[test]
    fn configured_home_precedes_environment_and_default() {
        let configured = PathBuf::from("configured-home");
        let resolved = resolve_from_sources(
            Some(configured.clone()),
            Some(PathBuf::from("environment-home")),
            Some(PathBuf::from("user-home")),
        )
        .unwrap();

        assert_eq!(resolved, configured);
    }

    #[test]
    fn environment_home_precedes_default() {
        let environment = PathBuf::from("environment-home");
        let resolved = resolve_from_sources(
            None,
            Some(environment.clone()),
            Some(PathBuf::from("user-home")),
        )
        .unwrap();

        assert_eq!(resolved, environment);
    }

    #[test]
    fn default_home_uses_dot_codex() {
        let home = PathBuf::from("user-home");
        let resolved = resolve_from_sources(None, None, Some(home.clone())).unwrap();

        assert_eq!(resolved, home.join(".codex"));
    }

    #[test]
    fn custom_home_requires_an_existing_absolute_directory() {
        let root =
            std::env::temp_dir().join(format!("codex-switch-home-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let file = root.join("not-a-directory");
        fs::write(&file, b"test").unwrap();

        let filesystem_root = root.ancestors().last().unwrap();
        assert_eq!(validate_custom_home(root.to_str().unwrap()).unwrap(), root);
        assert!(validate_custom_home("relative-home").is_err());
        assert!(validate_custom_home(filesystem_root.to_str().unwrap()).is_err());
        assert!(validate_custom_home(file.to_str().unwrap()).is_err());

        fs::remove_dir_all(root).unwrap();
    }
}
