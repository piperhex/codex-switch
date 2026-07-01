mod auth;
mod codex_api;
mod commands;
mod models;
mod oauth;
mod storage;

use oauth::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::get_app_info,
            commands::list_accounts,
            commands::import_auth_file,
            commands::switch_account,
            commands::delete_account,
            commands::refresh_usage,
            commands::fetch_reset_credits,
            oauth::start_login,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Codex Auth Manager");
}
