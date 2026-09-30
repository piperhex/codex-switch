//! Optional real-WebView regression harness, isolated from the running desktop app.
//! Start Vite on 1489, set FILE_PREVIEW_SMOKE_PATH to a local fixture, then run this ignored test.
use super::*;

#[test]
#[ignore = "interactive WebView smoke test; requires Vite and FILE_PREVIEW_SMOKE_PATH"]
fn opens_real_webview_preview() {
    let path = std::env::var("FILE_PREVIEW_SMOKE_PATH").expect("set the preview fixture path");
    let mut context = tauri::generate_context!();
    context.config_mut().identifier = "dev.codex.switch.file-preview-smoke".into();
    context.config_mut().app.windows.clear();
    context.config_mut().build.dev_url = Some("http://127.0.0.1:1489".parse().unwrap());
    tauri::Builder::default()
        .any_thread()
        .manage(GuiState::default())
        .manage(PreviewSessions::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .on_window_event(handle_window_event)
        .on_page_load(handle_page_load)
        .invoke_handler(tauri::generate_handler![
            codex_gui_open_file_preview,
            codex_gui_close_file_preview,
            website::codex_gui_sync_website_preview,
            website::codex_gui_close_website_preview,
            file_actions::codex_gui_file_action,
            file_actions::codex_gui_file_applications,
        ])
        .setup(move |app| {
            let mut url = url::Url::parse("http://127.0.0.1:1489/e2e/file-preview-harness.html")?;
            url.query_pairs_mut()
                .append_pair("native", "1")
                .append_pair("path", &path);
            tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::External(url))
                .title("Sidebar preview smoke test")
                .inner_size(1280.0, 800.0)
                .build()?;
            Ok(())
        })
        .run(context)
        .unwrap();
}
