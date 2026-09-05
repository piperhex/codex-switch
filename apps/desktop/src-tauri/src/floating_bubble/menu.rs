#[tauri::command]
pub(crate) fn drag_floating_bubble<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    app.get_webview_window(BUBBLE_LABEL)
        .ok_or_else(|| "悬浮球窗口不存在".to_string())?
        .start_dragging()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn show_floating_bubble_menu<R: Runtime>(
    app: AppHandle<R>,
    position: LogicalPosition<f64>,
) -> Result<(), String> {
    let window = app
        .get_webview_window(BUBBLE_LABEL)
        .ok_or_else(|| "floating bubble window does not exist".to_string())?;
    let position = bounded_menu_position(&window, position)?;
    let menu_app = app.clone();
    let menu = tauri::async_runtime::spawn_blocking(move || {
        crate::system_tray::build_menu(&menu_app).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())??;
    #[cfg(windows)]
    crate::system_tray::windows_menu::install_for_window(&window)?;
    window
        .popup_menu_at(&menu, position)
        .map_err(|error| error.to_string())
}

fn bounded_menu_position<R: Runtime>(
    window: &tauri::WebviewWindow<R>,
    position: LogicalPosition<f64>,
) -> Result<LogicalPosition<f64>, String> {
    let scale = window.scale_factor().map_err(|error| error.to_string())?;
    let window_size = window
        .inner_size()
        .map_err(|error| error.to_string())?
        .to_logical::<f64>(scale);
    validate_menu_position(position, window_size)
}

fn validate_menu_position(
    position: LogicalPosition<f64>,
    window_size: LogicalSize<f64>,
) -> Result<LogicalPosition<f64>, String> {
    if !position.x.is_finite() || !position.y.is_finite() {
        return Err("invalid floating menu position".to_string());
    }
    Ok(LogicalPosition::new(
        position.x.clamp(0.0, window_size.width),
        position.y.clamp(0.0, window_size.height),
    ))
}

#[tauri::command]
pub(crate) fn show_dashboard_from_bubble<R: Runtime>(app: AppHandle<R>) {
    crate::system_tray::show_dashboard(&app);
}

pub(crate) fn remember_position<R: Runtime>(window: &Window<R>) {
    let Ok(scale) = window.scale_factor() else {
        return;
    };
    let (Ok(position), Ok(size)) = (window.outer_position(), window.inner_size()) else {
        return;
    };
    let position = position.to_logical::<f64>(scale);
    let size = size.to_logical::<f64>(scale);
    let Ok(mut settings) = read_app_settings(window.app_handle()) else {
        return;
    };
    settings.bubble_x = Some(position.x + size.width - CLASSIC_WIDTH);
    settings.bubble_y = Some(position.y + size.height - CLASSIC_HEIGHT);
    let _ = write_app_settings(window.app_handle(), &settings);
}

#[cfg(test)]
mod tests {
    use super::validate_menu_position;
    use tauri::{LogicalPosition, LogicalSize};

    #[test]
    fn menu_position_stays_at_the_click_point() {
        let position = validate_menu_position(
            LogicalPosition::new(41.0, 73.0),
            LogicalSize::new(108.0, 108.0),
        )
        .expect("click position should be valid");

        assert_eq!(position.x, 41.0);
        assert_eq!(position.y, 73.0);
    }

    #[test]
    fn menu_position_is_bounded_to_the_bubble_window() {
        let position = validate_menu_position(
            LogicalPosition::new(-12.0, 130.0),
            LogicalSize::new(108.0, 108.0),
        )
        .expect("finite position should be valid");

        assert_eq!(position.x, 0.0);
        assert_eq!(position.y, 108.0);
    }

    #[test]
    fn menu_position_rejects_non_finite_coordinates() {
        let result = validate_menu_position(
            LogicalPosition::new(f64::NAN, 20.0),
            LogicalSize::new(108.0, 108.0),
        );

        assert!(result.is_err());
    }
}
