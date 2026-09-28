#[cfg(windows)]
mod windows;

pub(super) fn show(app: &tauri::AppHandle, thread_id: &str, title: &str) {
    #[cfg(windows)]
    if let Err(error) = windows::show(app, thread_id, title) {
        eprintln!("Codex GUI could not show a completion notification: {error}");
    }
    #[cfg(not(windows))]
    {
        use tauri_plugin_notification::NotificationExt;
        let _ = thread_id;
        if app
            .notification()
            .builder()
            .title(title)
            .body("本轮回复已完成，可以查看结果了。")
            .show()
            .is_err()
        {
            eprintln!("Codex GUI could not show a completion notification");
        }
    }
}
