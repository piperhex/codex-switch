use super::{windows, QuickMenuState, LABEL};
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Manager, Runtime};

/// Never waits on the session from a native window callback.
pub(super) fn request<R: Runtime>(app: &AppHandle<R>) {
    let revision = app
        .state::<QuickMenuState>()
        .presented_revision
        .load(Ordering::Acquire);
    if revision == 0 {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = dismiss_if_inactive(&app, revision).await {
            eprintln!("failed to dismiss inactive quick menu: {error}");
        }
    });
}

async fn dismiss_if_inactive<R: Runtime>(app: &AppHandle<R>, revision: u64) -> tauri::Result<()> {
    let state = app.state::<QuickMenuState>();
    let mut session = state.session.lock().await;
    let Some(window) = app.get_webview_window(LABEL) else {
        return Ok(());
    };
    // WebView focus may move within the popup. A queued blur must also not close a new opening.
    if !should_dismiss(
        session.open,
        session.snapshot.revision,
        revision,
        windows::is_foreground(&window)?,
    ) {
        return Ok(());
    }
    session.open = false;
    state.presented_revision.store(0, Ordering::Release);
    window.hide()
}

fn should_dismiss(
    open: bool,
    current_revision: u64,
    event_revision: u64,
    foreground: bool,
) -> bool {
    open && event_revision != 0 && current_revision == event_revision && !foreground
}

#[cfg(test)]
mod tests {
    use super::should_dismiss;

    #[test]
    fn dismisses_only_the_inactive_presented_menu() {
        assert!(should_dismiss(true, 3, 3, false));
        assert!(!should_dismiss(true, 3, 3, true));
        assert!(!should_dismiss(false, 3, 3, false));
        assert!(!should_dismiss(true, 3, 0, false));
    }

    #[test]
    fn stale_blur_cannot_dismiss_a_reopened_menu() {
        assert!(!should_dismiss(true, 4, 3, false));
    }
}
