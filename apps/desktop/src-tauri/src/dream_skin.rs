use std::{
    env, fs,
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex, OnceLock,
    },
    thread,
};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DreamSkinThemeSummary {
    pub(crate) id: String,
    pub(crate) name: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DreamSkinStatus {
    pub(crate) supported: bool,
    pub(crate) platform: String,
    pub(crate) installed: bool,
    pub(crate) runtime_installed: bool,
    pub(crate) session: String,
    pub(crate) active_theme_id: Option<String>,
    pub(crate) active_theme_name: Option<String>,
    pub(crate) active_theme_appearance: Option<String>,
    pub(crate) engine_path: Option<String>,
    pub(crate) saved_themes: Vec<DreamSkinThemeSummary>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DreamSkinResourcesStatus {
    pub(crate) phase: String,
    pub(crate) installed: bool,
    pub(crate) installed_version: Option<String>,
    pub(crate) available_version: Option<String>,
    pub(crate) downloaded_bytes: u64,
    pub(crate) total_bytes: Option<u64>,
    pub(crate) error: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DreamSkinImportOptions {
    pub(crate) name: String,
    pub(crate) appearance: String,
    pub(crate) safe_area: String,
    pub(crate) task_mode: String,
    pub(crate) focus_x: Option<f64>,
    pub(crate) focus_y: Option<f64>,
}

fn platform_name() -> &'static str {
    #[cfg(target_os = "windows")]
    return "windows";
    #[cfg(target_os = "macos")]
    return "macos";
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    return env::consts::OS;
}

pub(crate) fn state_root() -> Result<PathBuf, String> {
    #[cfg(target_os = "windows")]
    {
        return env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .map(|path| path.join("CodexDreamSkin"))
            .ok_or_else(|| "LOCALAPPDATA is unavailable.".to_string());
    }
    #[cfg(target_os = "macos")]
    {
        return dirs::home_dir()
            .map(|path| {
                path.join("Library")
                    .join("Application Support")
                    .join("CodexDreamSkinStudio")
            })
            .ok_or_else(|| "Home directory is unavailable.".to_string());
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        Err("Codex Dream Skin currently supports Windows and macOS.".to_string())
    }
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn unsupported_status() -> DreamSkinStatus {
    DreamSkinStatus {
        supported: false,
        platform: platform_name().to_string(),
        installed: false,
        runtime_installed: false,
        session: "unsupported".to_string(),
        active_theme_id: None,
        active_theme_name: None,
        active_theme_appearance: None,
        engine_path: None,
        saved_themes: Vec::new(),
    }
}

pub(crate) fn setup(app: &AppHandle) -> Result<(), String> {
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    {
        crate::dream_skin_resources::start_background_update();
        return crate::dream_skin_native::setup(app);
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = app;
        Ok(())
    }
}

#[tauri::command]
pub(crate) fn get_dream_skin_resources_status() -> DreamSkinResourcesStatus {
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    {
        let current = crate::dream_skin_resources::status();
        if current.phase == "idle" {
            crate::dream_skin_resources::start_background_update();
            return crate::dream_skin_resources::status();
        }
        return current;
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    DreamSkinResourcesStatus {
        phase: "unsupported".to_string(),
        installed: false,
        installed_version: None,
        available_version: None,
        downloaded_bytes: 0,
        total_bytes: None,
        error: None,
    }
}

#[tauri::command]
pub(crate) fn retry_dream_skin_resources() -> DreamSkinResourcesStatus {
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    {
        crate::dream_skin_resources::start_background_update();
        return crate::dream_skin_resources::status();
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    get_dream_skin_resources_status()
}

/// Starts ChatGPT/Codex through the Dream Skin launcher when the skin is
/// currently enabled.  Regular account-management restarts use this so they
/// keep the CDP arguments required for renderer injection.
pub(crate) fn restart_active_session() -> Result<bool, String> {
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    return crate::dream_skin_native::restart_active_session();
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    Ok(false)
}

/// Refreshes Codex's model picker through the managed renderer channel. This is
/// deliberately best-effort: Provider routing must keep working when Codex is
/// closed, Dream Skin is not installed, or a future Codex build changes its UI.
pub(crate) fn refresh_codex_models(models: Vec<String>, selected_model: String) {
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    {
        static GENERATION: AtomicU64 = AtomicU64::new(0);
        static REFRESH_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        let generation = GENERATION.fetch_add(1, Ordering::AcqRel) + 1;
        let _ = thread::Builder::new()
            .name("codex-model-picker-refresh".to_string())
            .spawn(move || {
                let _guard = REFRESH_LOCK
                    .get_or_init(|| Mutex::new(()))
                    .lock()
                    .unwrap_or_else(|error| error.into_inner());
                if GENERATION.load(Ordering::Acquire) != generation {
                    return;
                }
                if let Err(error) =
                    crate::dream_skin_native::refresh_codex_models(&models, &selected_model)
                {
                    eprintln!("Codex model picker refresh was skipped: {error}");
                }
            });
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = (models, selected_model);
    }
}

async fn run_blocking<T, F>(operation: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|error| format!("Dream Skin operation did not complete: {error}"))?
}

#[tauri::command]
pub(crate) fn get_dream_skin_status() -> DreamSkinStatus {
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    return crate::dream_skin_native::status(platform_name());
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    unsupported_status()
}

#[tauri::command]
pub(crate) async fn install_dream_skin(app: AppHandle) -> Result<DreamSkinStatus, String> {
    run_blocking(move || {
        #[cfg(any(target_os = "windows", target_os = "macos"))]
        crate::dream_skin_native::install(&app)?;
        #[cfg(not(any(target_os = "windows", target_os = "macos")))]
        return Err("Codex Dream Skin currently supports Windows and macOS.".to_string());
        Ok(get_dream_skin_status())
    })
    .await
}

#[tauri::command]
pub(crate) async fn apply_dream_skin_theme(
    app: AppHandle,
    theme_id: String,
) -> Result<DreamSkinStatus, String> {
    run_blocking(move || {
        #[cfg(any(target_os = "windows", target_os = "macos"))]
        crate::dream_skin_native::apply_theme(&app, &theme_id)?;
        #[cfg(not(any(target_os = "windows", target_os = "macos")))]
        return Err("Codex Dream Skin currently supports Windows and macOS.".to_string());
        Ok(get_dream_skin_status())
    })
    .await
}

#[tauri::command]
pub(crate) async fn import_dream_skin_image(
    app: AppHandle,
    path: String,
    options: DreamSkinImportOptions,
) -> Result<DreamSkinStatus, String> {
    run_blocking(move || {
        #[cfg(any(target_os = "windows", target_os = "macos"))]
        crate::dream_skin_native::import_image(&app, &path, &options)?;
        #[cfg(not(any(target_os = "windows", target_os = "macos")))]
        return Err("Codex Dream Skin currently supports Windows and macOS.".to_string());
        Ok(get_dream_skin_status())
    })
    .await
}

#[tauri::command]
pub(crate) async fn save_dream_skin_theme(
    app: AppHandle,
    name: String,
) -> Result<DreamSkinStatus, String> {
    run_blocking(move || {
        #[cfg(any(target_os = "windows", target_os = "macos"))]
        crate::dream_skin_native::save_theme(&app, &name)?;
        #[cfg(not(any(target_os = "windows", target_os = "macos")))]
        return Err("Codex Dream Skin currently supports Windows and macOS.".to_string());
        Ok(get_dream_skin_status())
    })
    .await
}

#[tauri::command]
pub(crate) async fn set_dream_skin_appearance(
    app: AppHandle,
    appearance: String,
) -> Result<DreamSkinStatus, String> {
    run_blocking(move || {
        #[cfg(any(target_os = "windows", target_os = "macos"))]
        crate::dream_skin_native::set_appearance(&app, &appearance)?;
        #[cfg(not(any(target_os = "windows", target_os = "macos")))]
        return Err("Codex Dream Skin currently supports Windows and macOS.".to_string());
        Ok(get_dream_skin_status())
    })
    .await
}

#[tauri::command]
pub(crate) async fn set_dream_skin_paused(
    app: AppHandle,
    paused: bool,
) -> Result<DreamSkinStatus, String> {
    run_blocking(move || {
        #[cfg(any(target_os = "windows", target_os = "macos"))]
        crate::dream_skin_native::set_paused(&app, paused)?;
        #[cfg(not(any(target_os = "windows", target_os = "macos")))]
        return Err("Codex Dream Skin currently supports Windows and macOS.".to_string());
        Ok(get_dream_skin_status())
    })
    .await
}

#[tauri::command]
pub(crate) async fn reapply_dream_skin(app: AppHandle) -> Result<DreamSkinStatus, String> {
    run_blocking(move || {
        #[cfg(any(target_os = "windows", target_os = "macos"))]
        crate::dream_skin_native::reapply(&app)?;
        #[cfg(not(any(target_os = "windows", target_os = "macos")))]
        return Err("Codex Dream Skin currently supports Windows and macOS.".to_string());
        Ok(get_dream_skin_status())
    })
    .await
}

#[tauri::command]
pub(crate) async fn verify_dream_skin(app: AppHandle) -> Result<String, String> {
    run_blocking(move || {
        #[cfg(any(target_os = "windows", target_os = "macos"))]
        return crate::dream_skin_native::verify(&app);
        #[cfg(not(any(target_os = "windows", target_os = "macos")))]
        Err("Codex Dream Skin currently supports Windows and macOS.".to_string())
    })
    .await
}

#[tauri::command]
pub(crate) async fn restore_dream_skin(app: AppHandle) -> Result<DreamSkinStatus, String> {
    run_blocking(move || {
        #[cfg(any(target_os = "windows", target_os = "macos"))]
        crate::dream_skin_native::restore(&app)?;
        #[cfg(not(any(target_os = "windows", target_os = "macos")))]
        return Err("Codex Dream Skin currently supports Windows and macOS.".to_string());
        Ok(get_dream_skin_status())
    })
    .await
}

#[tauri::command]
pub(crate) fn open_dream_skin_folder(app: AppHandle) -> Result<(), String> {
    let path = state_root()?;
    fs::create_dir_all(&path)
        .map_err(|error| format!("Failed to create {}: {error}", path.display()))?;
    app.opener()
        .open_path(path.display().to_string(), None::<&str>)
        .map_err(|error| format!("Failed to open {}: {error}", path.display()))
}

#[tauri::command]
pub(crate) fn get_dream_skin_theme_preview(theme_id: String) -> Result<Option<String>, String> {
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    return crate::dream_skin_native::theme_preview(&theme_id);
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = theme_id;
        Err("Codex Dream Skin currently supports Windows and macOS.".to_string())
    }
}

#[tauri::command]
pub(crate) async fn get_dream_skin_market(
) -> Result<crate::dream_skin_market::DreamSkinMarketResult, String> {
    run_blocking(crate::dream_skin_market::load).await
}

#[tauri::command]
pub(crate) async fn install_dream_skin_market_theme(
    theme_id: String,
) -> Result<DreamSkinStatus, String> {
    run_blocking(move || {
        crate::dream_skin_market::install(&theme_id)?;
        Ok(get_dream_skin_status())
    })
    .await
}

#[tauri::command]
pub(crate) async fn get_dream_skin_community_page(
    offset: usize,
    limit: usize,
) -> Result<crate::dream_skin_community::DreamSkinCommunityPage, String> {
    run_blocking(move || crate::dream_skin_community::load_page(offset, limit)).await
}

#[tauri::command]
pub(crate) async fn install_dream_skin_community_theme(
    version_id: String,
) -> Result<DreamSkinStatus, String> {
    run_blocking(move || {
        crate::dream_skin_community::install(&version_id)?;
        Ok(get_dream_skin_status())
    })
    .await
}
