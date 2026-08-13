#[cfg(any(target_os = "windows", target_os = "macos"))]
use std::{
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex, OnceLock,
    },
    thread,
};

use tauri::AppHandle;

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

/// Refreshes Codex's model and config caches through the managed renderer channel.
pub(crate) fn refresh_models(
    models: Vec<String>,
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
                if let Err(error) = crate::dream_skin_native::refresh_codex_models(
                    &models,
                    &selected_model,
                    reasoning_profile,
                ) {
                    eprintln!("Codex model picker refresh was skipped: {error}");
                }
            });
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = (models, selected_model, reasoning_profile);
    }
}
