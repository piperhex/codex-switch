use std::{
    fs, io,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
};

use chrono::{DateTime, Utc};
use serde_json::Value;
use tauri::{Manager, Runtime};

use crate::{
    auth::{account_fields, canonicalize_chatgpt_auth, validate_auth},
    models::{
        AccountFieldModifiedAt, AccountPrivateDetails, AppSettings, ManagerStateFile, UsageSummary,
        DEFAULT_CLOUD_BASE_URL,
    },
};

#[derive(Clone, Copy)]
pub(crate) enum AccountSyncField {
    Auth,
    Note,
    ExpiresAt,
    PrivateDetails,
    Usage,
    Active,
    AutoSwitchPriority,
    AutoSwitchThreshold,
}

#[derive(Clone)]
pub(crate) struct Paths {
    pub(crate) codex_home: PathBuf,
    pub(crate) current_auth: PathBuf,
    pub(crate) current_config: PathBuf,
    pub(crate) accounts: PathBuf,
    pub(crate) providers: PathBuf,
    pub(crate) config_backup: PathBuf,
    pub(crate) state_file: PathBuf,
}

static TEMP_FILE_COUNTER: AtomicU64 = AtomicU64::new(1);
static MANAGED_AUTH_WRITE_LOCK: Mutex<()> = Mutex::new(());
const UNMODIFIED_FIELD_AT: &str = "1970-01-01T00:00:00Z";

fn atomic_temp_path(path: &Path) -> PathBuf {
    path.with_extension(format!(
        "tmp-{}-{}",
        std::process::id(),
        TEMP_FILE_COUNTER.fetch_add(1, Ordering::Relaxed)
    ))
}

pub(crate) fn resolve_paths<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<Paths, String> {
    let codex_home = crate::codex_home::resolve()?;
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法定位应用数据目录：{error}"))?;
    let accounts = app_data.join("accounts");
    let providers = app_data.join("providers");
    Ok(Paths {
        current_auth: codex_home.join("auth.json"),
        current_config: codex_home.join("config.toml"),
        codex_home,
        config_backup: app_data.join("config-before-provider.toml"),
        state_file: app_data.join("state.json"),
        accounts,
        providers,
    })
}

pub(crate) fn read_json(path: &Path) -> Result<Value, String> {
    let bytes = fs::read(path).map_err(|error| format!("读取 {} 失败：{error}", path.display()))?;
    serde_json::from_slice(&bytes)
        .map_err(|error| format!("{} 不是有效 JSON：{error}", path.display()))
}

pub(crate) fn write_json_atomic(path: &Path, value: &Value) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "目标路径没有父目录".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("创建 {} 失败：{error}", parent.display()))?;
    let bytes =
        serde_json::to_vec_pretty(value).map_err(|error| format!("序列化 JSON 失败：{error}"))?;
    let temp = atomic_temp_path(path);
    fs::write(&temp, bytes).map_err(|error| format!("写入临时文件失败：{error}"))?;
    replace_file(&temp, path).map_err(|error| format!("提交 {} 失败：{error}", path.display()))
}

pub(crate) fn write_text_atomic(path: &Path, value: &str) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Target path has no parent directory".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Failed to create {}: {error}", parent.display()))?;
    let temp = atomic_temp_path(path);
    fs::write(&temp, value.as_bytes())
        .map_err(|error| format!("Failed to write temporary file: {error}"))?;
    replace_file(&temp, path).map_err(|error| format!("Failed to save {}: {error}", path.display()))
}

pub(crate) fn write_text_if_changed(path: &Path, value: &str) -> Result<bool, String> {
    match fs::read(path) {
        Ok(existing) if existing == value.as_bytes() => return Ok(false),
        Ok(_) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(format!("Failed to read {}: {error}", path.display()));
        }
    }
    write_text_atomic(path, value)?;
    Ok(true)
}

pub(crate) fn write_json_if_changed(path: &Path, value: &Value) -> Result<bool, String> {
    if let Ok(existing) = read_json(path) {
        if existing == *value {
            return Ok(false);
        }
    }
    write_json_atomic(path, value)?;
    Ok(true)
}

#[cfg(not(windows))]
pub(crate) fn replace_file(source: &Path, destination: &Path) -> io::Result<()> {
    fs::rename(source, destination)
}

#[cfg(windows)]
pub(crate) fn replace_file(source: &Path, destination: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let mut source_wide: Vec<u16> = source.as_os_str().encode_wide().collect();
    source_wide.push(0);
    let mut destination_wide: Vec<u16> = destination.as_os_str().encode_wide().collect();
    destination_wide.push(0);
    let result = unsafe {
        MoveFileExW(
            source_wide.as_ptr(),
            destination_wide.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if result == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}
