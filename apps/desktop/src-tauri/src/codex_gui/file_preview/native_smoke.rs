//! Optional real-WebView regression harness, isolated from the running desktop app.
//! Start Vite on 1489, set FILE_PREVIEW_SMOKE_PATH to a local fixture, then run this ignored test.
use super::*;

#[test]
#[ignore = "interactive WebView smoke test; requires Vite and FILE_PREVIEW_SMOKE_PATH"]
fn opens_real_webview_preview() {
    let path = std::env::var("FILE_PREVIEW_SMOKE_PATH").expect("set the preview fixture path");
    let target = serde_json::from_value::<FileTarget>(serde_json::json!({ "path": path })).unwrap();
    let mut context = tauri::generate_context!();
    context.config_mut().identifier = "dev.codex.switch.file-preview-smoke".into();
    context.config_mut().app.windows.clear();
    context.config_mut().build.dev_url = Some("http://127.0.0.1:1489".parse().unwrap());
    tauri::Builder::default()
        .any_thread()
        .manage(GuiState::default())
        .manage(PreviewWindows::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .on_window_event(handle_window_event)
        .invoke_handler(tauri::generate_handler![
            codex_gui_open_file_preview,
            codex_gui_read_file_preview,
            file_actions::codex_gui_file_action,
            file_actions::codex_gui_file_applications,
        ])
        .setup(move |app| {
            let app = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                assert!(codex_gui_open_file_preview(app, target).await.unwrap());
            });
            Ok(())
        })
        .run(context)
        .unwrap();
}
