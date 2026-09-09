use serde::Serialize;
use tauri::{AppHandle, WebviewWindow};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChatConnectionConfig {
    websocket_url: String,
    access_token: String,
    device_id: String,
}

/// Only the main, locally bundled window may establish the authenticated chat host.
#[tauri::command]
pub(crate) async fn remote_chat_config(
    app: AppHandle,
    window: WebviewWindow,
) -> Result<Option<ChatConnectionConfig>, String> {
    if window.label() != "main" {
        return Err("请在主窗口连接手机聊天。".to_string());
    }
    tauri::async_runtime::spawn_blocking(move || {
        crate::cloud::remote_control_config(&app).map(|config| {
            config.map(|config| ChatConnectionConfig {
                websocket_url: config
                    .websocket_url
                    .trim_end_matches("device-switch")
                    .to_owned()
                    + "device-chat",
                access_token: config.access_token,
                device_id: config.device_id,
            })
        })
    })
    .await
    .map_err(|_| "暂时无法连接手机聊天，请稍后重试。".to_string())?
    .map_err(|_| "请检查云端登录状态和网络后重试。".to_string())
}
