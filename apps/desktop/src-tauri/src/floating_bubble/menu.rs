#[tauri::command]
pub(crate) fn drag_floating_bubble<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    app.get_webview_window(BUBBLE_LABEL)
        .ok_or_else(|| "悬浮球窗口不存在".to_string())?
        .start_dragging()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn show_floating_bubble_menu<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let window = app
        .get_webview_window(BUBBLE_LABEL)
        .ok_or_else(|| "floating bubble window does not exist".to_string())?;
    let menu = crate::system_tray::build_menu(&app).map_err(|error| error.to_string())?;
    let position = floating_menu_position(&app, &window)?;
    window
        .popup_menu_at(&menu, position)
        .map_err(|error| error.to_string())
}

fn floating_menu_position<R: Runtime>(
    app: &AppHandle<R>,
    window: &tauri::WebviewWindow<R>,
) -> Result<LogicalPosition<f64>, String> {
    let scale = window.scale_factor().map_err(|error| error.to_string())?;
    let window_position = window
        .outer_position()
        .map_err(|error| error.to_string())?
        .to_logical::<f64>(scale);
    let window_size = window
        .inner_size()
        .map_err(|error| error.to_string())?
        .to_logical::<f64>(scale);
    let monitor = window
        .current_monitor()
        .map_err(|error| error.to_string())?
        .or_else(|| app.primary_monitor().ok().flatten());
    let Some(monitor) = monitor else {
        return Ok(LogicalPosition::new(0.0, 0.0));
    };
    let area = monitor.work_area();
    let area_position = area.position.to_logical::<f64>(monitor.scale_factor());
    let area_size = area.size.to_logical::<f64>(monitor.scale_factor());
    let (menu_width, menu_height) = estimated_floating_menu_size(app);
    let area_right = area_position.x + area_size.width;
    let area_bottom = area_position.y + area_size.height;

    let bubble_center_x =
        window_position.x + window_size.width - BUBBLE_EDGE_INSET - (BUBBLE_SIZE / 2.0);
    let bubble_top_y = window_position.y + window_size.height - BUBBLE_EDGE_INSET - BUBBLE_SIZE;
    let mut menu_screen_x = bubble_center_x - (menu_width / 2.0);
    let mut menu_screen_y = bubble_top_y - (menu_height * MENU_VERTICAL_ATTACH_RATIO);
    menu_screen_x = clamp_menu_axis(
        menu_screen_x,
        area_position.x + MENU_SCREEN_MARGIN,
        area_right - menu_width - MENU_SCREEN_MARGIN,
    );
    menu_screen_y = clamp_menu_axis(
        menu_screen_y,
        area_position.y + MENU_SCREEN_MARGIN,
        area_bottom - menu_height - MENU_SCREEN_MARGIN,
    );

    Ok(LogicalPosition::new(
        menu_screen_x - window_position.x,
        menu_screen_y - window_position.y,
    ))
}

fn clamp_menu_axis(value: f64, min: f64, max: f64) -> f64 {
    if max < min {
        min
    } else {
        value.clamp(min, max)
    }
}

fn estimated_floating_menu_size<R: Runtime>(app: &AppHandle<R>) -> (f64, f64) {
    let mut labels = match commands::list_accounts_blocking(app.clone()) {
        Ok(accounts) if accounts.is_empty() => vec!["No accounts".to_string()],
        Ok(accounts) => accounts
            .into_iter()
            .map(|account| {
                format!(
                    "{} | 5h {} | 1week {}",
                    truncate_menu_email(&account.email),
                    menu_remaining_label(account.usage.primary.as_ref()),
                    menu_remaining_label(account.usage.secondary.as_ref()),
                )
            })
            .collect::<Vec<_>>(),
        Err(error) => vec![format!("Accounts error: {error}")],
    };
    labels.push("Providers".to_string());
    match providers::list_providers(app.clone()) {
        Ok(providers) if providers.is_empty() => labels.push("No providers".to_string()),
        Ok(providers) => labels.extend(
            providers
                .into_iter()
                .map(|provider| crate::system_tray::provider_label(&provider)),
        ),
        Err(error) => labels.push(format!("Providers error: {error}")),
    }
    let max_chars = labels
        .iter()
        .map(|label| label.chars().count())
        .chain([9, 15, 20, 4])
        .max()
        .unwrap_or(20);
    let width = ((max_chars as f64) * 8.8 + 92.0).clamp(230.0, 520.0);
    let height = ((labels.len() + MENU_ACTION_ROW_COUNT) as f64) * 32.0 + 26.0;
    (width, height)
}

fn menu_remaining_label(window: Option<&UsageWindow>) -> String {
    window
        .map(|window| format!("{}%", window.remaining_percent.round().clamp(0.0, 100.0)))
        .unwrap_or_else(|| "--".to_string())
}

fn truncate_menu_email(text: &str) -> String {
    let mut chars = text.chars();
    let truncated = chars.by_ref().take(MENU_EMAIL_CHARS).collect::<String>();
    if chars.next().is_some() {
        format!("{truncated}...")
    } else {
        truncated
    }
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
