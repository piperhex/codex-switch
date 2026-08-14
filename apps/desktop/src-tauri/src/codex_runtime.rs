#[cfg(any(target_os = "windows", target_os = "macos"))]
use std::{
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex, OnceLock,
    },
    thread,
};

use tauri::AppHandle;

#[cfg(target_os = "windows")]
use std::path::Path;

/// Initializes the managed Codex renderer channel independently from Dream Skin.
pub(crate) fn setup(app: &AppHandle) -> Result<(), String> {
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    return crate::dream_skin_native::setup_runtime(app);
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = app;
        Ok(())
    }
}

/// Relaunches Codex with the local renderer channel. Theme injection remains
/// controlled exclusively by Dream Skin's installation and pause state.
pub(crate) fn restart_managed_session() -> Result<bool, String> {
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    return match crate::dream_skin_native::restart_runtime_session() {
        Ok(()) => Ok(true),
        Err(error) if error == "Codex runtime is not initialized." => Ok(false),
        Err(error) => Err(error),
    };
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    Ok(false)
}

/// Updates the executable used by the next managed restart. ChatGPT updates can
/// leave the previously remembered Store path valid, so restart callers must
/// publish the path observed for the current process before stopping it.
#[cfg(target_os = "windows")]
pub(crate) fn record_launch_executable(path: &str) -> Result<(), String> {
    crate::dream_skin_native::record_runtime_executable(Path::new(path))
}

/// Refreshes Codex's model and config caches through the managed renderer channel.
pub(crate) fn refresh_models(
    models: Vec<String>,
    image_input_models: Vec<String>,
    model_reasoning_efforts: crate::models::ModelReasoningEfforts,
    selected_model: String,
    reasoning_profile: crate::providers::ReasoningEffortProfile,
) {
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
                match crate::dream_skin_native::refresh_codex_models(
                    &models,
                    &image_input_models,
                    &model_reasoning_efforts,
                    &selected_model,
                    reasoning_profile,
                ) {
                    Ok(result) if result.refreshed => {}
                    Ok(result) => eprintln!(
                        "Codex model picker refresh was skipped: {}",
                        result.reason.as_deref().unwrap_or("unknown reason")
                    ),
                    Err(error) => {
                        eprintln!("Codex model picker refresh failed: {error}");
                    }
                }
            });
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = (
            models,
            image_input_models,
            model_reasoning_efforts,
            selected_model,
            reasoning_profile,
        );
    }
}
