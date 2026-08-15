use tauri::{Manager, Runtime, WebviewUrl, WebviewWindowBuilder};

pub(crate) const TOTP_WINDOW_LABEL: &str = "totp";
const WINDOW_SIZE_RATIO: f64 = 0.6;
const FALLBACK_WIDTH: f64 = 960.0;
const FALLBACK_HEIGHT: f64 = 640.0;

fn scaled_window_size(width: f64, height: f64) -> (f64, f64) {
    (width * WINDOW_SIZE_RATIO, height * WINDOW_SIZE_RATIO)
}

fn window_size<R: Runtime>(app: &tauri::AppHandle<R>) -> (f64, f64) {
    let monitor = app
        .get_webview_window("main")
        .and_then(|window| window.current_monitor().ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten());
    let Some(monitor) = monitor else {
        return (FALLBACK_WIDTH, FALLBACK_HEIGHT);
    };
    let size = monitor
        .work_area()
        .size
        .to_logical::<f64>(monitor.scale_factor());
    scaled_window_size(size.width, size.height)
}

#[tauri::command]
pub(crate) async fn show_totp_window<R: Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(TOTP_WINDOW_LABEL) {
        window.unminimize().map_err(|error| error.to_string())?;
        window.show().map_err(|error| error.to_string())?;
        return window.set_focus().map_err(|error| error.to_string());
    }

    let (width, height) = window_size(&app);
    WebviewWindowBuilder::new(
        &app,
        TOTP_WINDOW_LABEL,
        WebviewUrl::App("index.html#totp".into()),
    )
    .title("2FA")
    .inner_size(width, height)
    .center()
    .resizable(true)
    .maximizable(true)
    .closable(true)
    .build()
    .map(|_| ())
    .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::scaled_window_size;

    #[test]
    fn window_uses_sixty_percent_of_the_screen() {
        assert_eq!(scaled_window_size(1920.0, 1080.0), (1152.0, 648.0));
    }
}
