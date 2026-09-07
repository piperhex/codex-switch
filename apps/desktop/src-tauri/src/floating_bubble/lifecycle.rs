use std::{
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Mutex,
    },
    thread,
    time::Duration,
};

use tauri::{AppHandle, Emitter, Manager, Runtime, Window, WindowEvent};

use super::{create, position, read_app_settings, write_app_settings, AppSettings, BUBBLE_LABEL};

const RECOVERY_INTERVAL: Duration = Duration::from_secs(5);
const ENABLED_CHANGED_EVENT: &str = "floating-bubble-enabled-changed";

/// Serializes recovery, explicit toggles and position persistence on background workers.
#[derive(Default)]
pub(crate) struct BubbleLifecycle {
    pub(super) operation: Mutex<()>,
    stopping: AtomicBool,
    pub(super) position_revision: AtomicU64,
    pub(super) position_saving: AtomicBool,
}

pub(super) fn start<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    thread::Builder::new()
        .name("floating-bubble-recovery".into())
        .spawn(move || {
            let state = app.state::<BubbleLifecycle>();
            while !state.stopping.load(Ordering::Acquire) {
                if let Err(error) = reconcile(&app) {
                    eprintln!("failed to restore floating usage window; will retry: {error}");
                }
                thread::sleep(RECOVERY_INTERVAL);
            }
        })
        .map(|_| ())
        .map_err(|error| error.to_string())
}

pub(crate) fn shutdown<R: Runtime>(app: &AppHandle<R>) {
    if let Some(state) = app.try_state::<BubbleLifecycle>() {
        state.stopping.store(true, Ordering::Release);
    }
}

pub(crate) fn handle_window_event<R: Runtime>(window: &Window<R>, event: &WindowEvent) {
    if window.label() != BUBBLE_LABEL {
        return;
    }
    match event {
        // Explicitly disabling the feature uses destroy(), which bypasses this guard.
        WindowEvent::CloseRequested { api, .. } => api.prevent_close(),
        WindowEvent::Moved(_) => position::remember(window),
        WindowEvent::Destroyed => eprintln!("floating usage window destroyed"),
        _ => {}
    }
}

fn reconcile<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    reconcile_with(app, apply_window_state)
}

fn reconcile_with<R: Runtime>(
    app: &AppHandle<R>,
    apply: impl FnOnce(&AppHandle<R>, &AppSettings) -> Result<(), String>,
) -> Result<(), String> {
    let state = app.state::<BubbleLifecycle>();
    let _guard = state.operation.lock().map_err(|error| error.to_string())?;
    if state.stopping.load(Ordering::Acquire) {
        return Ok(());
    }
    apply(app, &read_app_settings(app)?)
}

pub(super) fn update_enabled<R: Runtime>(
    app: &AppHandle<R>,
    enabled: Option<bool>,
) -> Result<AppSettings, String> {
    let state = app.state::<BubbleLifecycle>();
    let _guard = state.operation.lock().map_err(|error| error.to_string())?;
    if state.stopping.load(Ordering::Acquire) {
        return Err("应用正在退出，请稍后重试。".into());
    }
    let mut settings = read_app_settings(app)?;
    settings.floating_bubble_enabled = enabled.unwrap_or(!settings.floating_bubble_enabled);
    write_app_settings(app, &settings)?;
    if let Err(error) = app.emit(ENABLED_CHANGED_EVENT, settings.floating_bubble_enabled) {
        eprintln!("failed to notify floating usage setting change: {error}");
    }
    // Keep the saved preference on failure: the supervisor retries without requiring another toggle.
    if let Err(error) = apply_window_state(app, &settings) {
        eprintln!("failed to apply floating usage setting; will retry: {error}");
        return Err("悬浮用量显示暂时未能更新，将自动重试。".into());
    }
    Ok(settings)
}

#[derive(Debug, PartialEq)]
enum RecoveryAction {
    None,
    Create,
    Restore,
    Destroy,
}

fn recovery_action(enabled: bool, window_visible: Option<bool>) -> RecoveryAction {
    match (enabled, window_visible) {
        (true, None) => RecoveryAction::Create,
        (true, Some(false)) => RecoveryAction::Restore,
        (false, Some(_)) => RecoveryAction::Destroy,
        _ => RecoveryAction::None,
    }
}

fn apply_window_state<R: Runtime>(
    app: &AppHandle<R>,
    settings: &AppSettings,
) -> Result<(), String> {
    let window = app.get_webview_window(BUBBLE_LABEL);
    let visible = window
        .as_ref()
        .map(|window| {
            // Closing must still work if querying a damaged window's visibility fails.
            Ok::<_, tauri::Error>(
                !settings.floating_bubble_enabled
                    || (window.is_visible()? && !window.is_minimized()?),
            )
        })
        .transpose()
        .map_err(|error| error.to_string())?;
    match recovery_action(settings.floating_bubble_enabled, visible) {
        RecoveryAction::Create => create(app, settings),
        RecoveryAction::Restore => {
            if let Some(window) = window {
                window.unminimize().map_err(|error| error.to_string())?;
                window
                    .set_always_on_top(true)
                    .map_err(|error| error.to_string())?;
                window.show().map_err(|error| error.to_string())?;
            }
            Ok(())
        }
        RecoveryAction::Destroy => {
            if let Some(window) = window {
                window.destroy().map_err(|error| error.to_string())?;
            }
            Ok(())
        }
        RecoveryAction::None => Ok(()),
    }
}

#[cfg(test)]
mod tests;
