use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    sync::{OnceLock, RwLock},
};

use tauri::{Emitter, Runtime};

use crate::{
    models::{AppSettings, CodexHomeEntry},
    storage::{
        read_app_settings, resolve_paths, sync_current_into_store, try_read_state,
        write_app_settings,
    },
};

static CODEX_HOME_OVERRIDES: OnceLock<RwLock<Vec<ConfiguredCodexHome>>> = OnceLock::new();

const CODEX_HOME_ENV: &str = "CODEX_HOME";
const DEFAULT_CODEX_HOME_DIRECTORY: &str = ".codex";
const HOME_CHANGE_EVENTS: [&str; 2] = ["accounts-changed", "providers-changed"];

#[derive(Clone, PartialEq, Eq)]
pub(crate) struct ConfiguredCodexHome {
    pub(crate) id: Option<String>,
    pub(crate) path: PathBuf,
}

fn is_safe_home_path(path: &Path) -> bool {
    path.is_absolute() && path.parent().is_some()
}

fn override_store() -> &'static RwLock<Vec<ConfiguredCodexHome>> {
    CODEX_HOME_OVERRIDES.get_or_init(|| RwLock::new(Vec::new()))
}

fn replace_overrides(value: Vec<ConfiguredCodexHome>) {
    let mut configured = override_store()
        .write()
        .unwrap_or_else(|error| error.into_inner());
    *configured = value;
}

fn current_overrides() -> Vec<ConfiguredCodexHome> {
    override_store()
        .read()
        .unwrap_or_else(|error| error.into_inner())
        .clone()
}

fn configured_entries(entries: &[CodexHomeEntry]) -> Vec<ConfiguredCodexHome> {
    entries
        .iter()
        .filter(|entry| entry.enabled)
        .map(|entry| ConfiguredCodexHome {
            id: Some(entry.id.clone()),
            path: PathBuf::from(&entry.path),
        })
        .filter(|entry| is_safe_home_path(&entry.path))
        .collect()
}

pub(crate) fn initialize(settings: &AppSettings) {
    let mut entries = configured_entries(&settings.codex_homes);
    if entries.is_empty() {
        entries.extend(
            settings
                .codex_home
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(PathBuf::from)
                .filter(|path| is_safe_home_path(path))
                .map(|path| ConfiguredCodexHome { id: None, path }),
        );
    }
    replace_overrides(entries);
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
        current_overrides().first().map(|entry| entry.path.clone()),
        environment_codex_home(),
        dirs::home_dir(),
    )
}

pub(crate) fn resolve_all() -> Result<Vec<ConfiguredCodexHome>, String> {
    let configured = current_overrides();
    if !configured.is_empty() {
        return Ok(configured);
    }
    Ok(vec![ConfiguredCodexHome {
        id: None,
        path: resolve_from_sources(None, environment_codex_home(), dirs::home_dir())?,
    }])
}

pub(crate) fn replicated_paths(path: &Path) -> Vec<PathBuf> {
    let Ok(primary) = resolve() else {
        return vec![path.to_path_buf()];
    };
    let Ok(relative) = path.strip_prefix(primary) else {
        return vec![path.to_path_buf()];
    };
    resolve_all()
        .map(|homes| {
            homes
                .into_iter()
                .map(|home| home.path.join(relative))
                .collect()
        })
        .unwrap_or_else(|_| vec![path.to_path_buf()])
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
    let path = expand_home_alias(trimmed);
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

fn expand_home_alias(value: &str) -> PathBuf {
    let Some(home) = dirs::home_dir() else {
        return PathBuf::from(value);
    };
    if value == "~" {
        return home;
    }
    if let Some(suffix) = value
        .strip_prefix("~/")
        .or_else(|| value.strip_prefix("~\\"))
    {
        return home.join(suffix);
    }
    for prefix in ["%USERPROFILE%", "%HOME%"] {
        if value.eq_ignore_ascii_case(prefix) {
            return home;
        }
        if value.len() > prefix.len()
            && value
                .get(..prefix.len())
                .is_some_and(|value| value.eq_ignore_ascii_case(prefix))
            && matches!(value.as_bytes()[prefix.len()], b'/' | b'\\')
        {
            return home.join(&value[prefix.len() + 1..]);
        }
    }
    PathBuf::from(value)
}

fn normalize_entries(entries: Vec<CodexHomeEntry>) -> Result<Vec<CodexHomeEntry>, String> {
    if entries.len() > 20 {
        return Err("最多可添加 20 个 Codex Home".to_string());
    }
    let mut normalized = Vec::with_capacity(entries.len());
    let mut ids = HashSet::with_capacity(entries.len());
    for entry in entries {
        let path = validate_custom_home(&entry.path)?;
        if normalized
            .iter()
            .any(|existing: &CodexHomeEntry| paths_match(Path::new(&existing.path), &path))
        {
            return Err("Codex Home 路径不能重复".to_string());
        }
        let id = normalized_entry_id(&entry.id);
        validate_entry_id(&id)?;
        if !ids.insert(id.clone()) {
            return Err("Codex Home 记录标识不能重复".to_string());
        }
        normalized.push(CodexHomeEntry {
            id,
            path: path.to_string_lossy().into_owned(),
            enabled: entry.enabled,
        });
    }
    Ok(normalized)
}

fn normalized_entry_id(id: &str) -> String {
    let trimmed = id.trim();
    if trimmed.is_empty() {
        uuid::Uuid::new_v4().to_string()
    } else {
        trimmed.to_string()
    }
}

fn validate_entry_id(id: &str) -> Result<(), String> {
    if id.is_empty()
        || id.len() > 64
        || !id
            .bytes()
            .all(|value| value.is_ascii_alphanumeric() || matches!(value, b'-' | b'_'))
    {
        return Err("Codex Home 记录标识无效".to_string());
    }
    Ok(())
}

fn paths_match(left: &Path, right: &Path) -> bool {
    match (fs::canonicalize(left), fs::canonicalize(right)) {
        (Ok(left), Ok(right)) => left == right,
        _ => left == right,
    }
}

fn sync_configured_homes<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<(), String> {
    if !crate::claude_code::should_write_codex_for_app(app)? {
        return Ok(());
    }
    if crate::local_proxy::is_running() {
        return crate::providers::apply_local_proxy_config_for_state(app);
    }
    let paths = resolve_paths(app)?;
    let state = try_read_state(&paths)?;
    let Some(account_id) = state.active_account_id.as_deref() else {
        return Ok(());
    };
    let auth = crate::commands::load_validated_managed_auth(&paths, account_id)?;
    for target in crate::storage::resolve_enabled_paths(app)? {
        crate::storage::write_json_atomic(&target.current_auth, &auth)?;
        crate::providers::restore_official_config(&target)?;
    }
    Ok(())
}

fn refresh_selected_homes<R: Runtime>(app: &tauri::AppHandle<R>) {
    if let Err(error) = sync_configured_homes(app) {
        eprintln!("failed to synchronize enabled Codex Homes: {error}");
    }
    for event in HOME_CHANGE_EVENTS {
        if let Err(error) = app.emit(event, ()) {
            eprintln!("failed to emit {event} after changing Codex Home: {error}");
        }
    }
    crate::system_tray::refresh_menu(app);
}

fn detach_disabled_homes<R: Runtime>(
    app: &tauri::AppHandle<R>,
    current: &[ConfiguredCodexHome],
    requested: &[ConfiguredCodexHome],
) -> Result<(), String> {
    if !crate::claude_code::should_write_codex_for_app(app)? {
        return Ok(());
    }
    let paths = crate::storage::resolve_enabled_paths(app)?;
    let active_auth = if let Some(primary) = paths.first() {
        let state = try_read_state(primary)?;
        state
            .active_account_id
            .as_deref()
            .map(|id| crate::commands::load_validated_managed_auth(primary, id))
            .transpose()?
    } else {
        None
    };
    for (home, target) in current.iter().zip(paths.iter()) {
        if requested
            .iter()
            .any(|next| paths_match(&home.path, &next.path))
        {
            continue;
        }
        if let Some(auth) = active_auth.as_ref() {
            crate::storage::write_json_atomic(&target.current_auth, auth)?;
        }
        crate::providers::restore_default_official_config(target)?;
    }
    Ok(())
}

fn update_codex_home<R: Runtime>(
    app: &tauri::AppHandle<R>,
    requested_path: Option<String>,
) -> Result<AppSettings, String> {
    let entries = requested_path
        .map(|path| {
            vec![CodexHomeEntry {
                id: uuid::Uuid::new_v4().to_string(),
                path,
                enabled: true,
            }]
        })
        .unwrap_or_default();
    update_codex_homes(app, entries)
}

fn update_codex_homes<R: Runtime>(
    app: &tauri::AppHandle<R>,
    entries: Vec<CodexHomeEntry>,
) -> Result<AppSettings, String> {
    let entries = normalize_entries(entries)?;
    let requested = configured_entries(&entries);
    let requested_primary = requested.first().map(|entry| entry.path.as_path());
    let _switch_guard = crate::commands::account_switch_lock()
        .lock()
        .map_err(|_| "Codex Home 设置锁不可用".to_string())?;
    let current = resolve_all()?;
    let current_home = resolve()?;
    let next_home = resolve_for_override(requested_primary)?;
    let requested_effective = if requested.is_empty() {
        vec![ConfiguredCodexHome {
            id: None,
            path: next_home.clone(),
        }]
    } else {
        requested.clone()
    };
    let primary_changed = !paths_match(&current_home, &next_home);
    if primary_changed && !crate::local_proxy::is_running() {
        if let Err(error) = sync_current_into_store(app) {
            eprintln!("failed to import auth.json before changing Codex Homes: {error}");
        }
    }
    detach_disabled_homes(app, &current, &requested_effective)?;
    let mut settings = read_app_settings(app)?;
    settings.codex_home = requested
        .first()
        .map(|entry| entry.path.as_os_str().to_string_lossy().into_owned());
    settings.codex_homes = entries;
    write_app_settings(app, &settings)?;

    let list_changed = current != requested_effective;
    replace_overrides(requested);
    if list_changed {
        refresh_selected_homes(app);
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

#[tauri::command]
pub(crate) async fn set_codex_homes<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    homes: Vec<CodexHomeEntry>,
) -> Result<AppSettings, String> {
    tauri::async_runtime::spawn_blocking(move || update_codex_homes(&app, homes))
        .await
        .map_err(|error| format!("Codex Home 设置任务失败：{error}"))?
}

#[cfg(test)]
mod tests {
    use super::{expand_home_alias, normalize_entries, resolve_from_sources, validate_custom_home};
    use crate::models::CodexHomeEntry;
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

    #[test]
    fn home_aliases_expand_to_absolute_paths() {
        let home = dirs::home_dir().unwrap();
        assert_eq!(expand_home_alias("~/.codex"), home.join(".codex"));
        assert_eq!(
            expand_home_alias("%USERPROFILE%\\.codex"),
            home.join(".codex")
        );
    }

    #[test]
    fn multiple_enabled_homes_are_preserved() {
        let root =
            std::env::temp_dir().join(format!("codex-switch-home-test-{}", uuid::Uuid::new_v4()));
        let second = root.join("second");
        fs::create_dir_all(&second).unwrap();
        let entries = vec![
            CodexHomeEntry {
                id: "one".to_string(),
                path: root.to_string_lossy().into_owned(),
                enabled: true,
            },
            CodexHomeEntry {
                id: "two".to_string(),
                path: second.to_string_lossy().into_owned(),
                enabled: true,
            },
        ];
        let normalized = normalize_entries(entries).unwrap();
        assert_eq!(normalized.len(), 2);
        assert!(normalized.iter().all(|entry| entry.enabled));
        fs::remove_dir_all(root).unwrap();
    }
}
