#[tauri::command]
pub(crate) fn get_app_settings<R: Runtime>(app: AppHandle<R>) -> Result<AppSettings, String> {
    read_app_settings(&app)
}

#[tauri::command]
pub(crate) async fn set_floating_bubble<R: Runtime>(
    app: AppHandle<R>,
    enabled: bool,
) -> Result<AppSettings, String> {
    let mut settings = read_app_settings(&app)?;
    settings.floating_bubble_enabled = enabled;
    write_app_settings(&app, &settings)?;

    if enabled {
        create(&app, &settings)?;
    } else if let Some(window) = app.get_webview_window(BUBBLE_LABEL) {
        window.close().map_err(|error| error.to_string())?;
    }
    Ok(settings)
}

#[tauri::command]
pub(crate) fn set_privacy_mode<R: Runtime>(
    app: AppHandle<R>,
    enabled: bool,
) -> Result<AppSettings, String> {
    let mut settings = read_app_settings(&app)?;
    settings.privacy_mode = enabled;
    write_app_settings(&app, &settings)?;
    Ok(settings)
}

#[tauri::command]
pub(crate) fn set_hide_account_notes<R: Runtime>(
    app: AppHandle<R>,
    enabled: bool,
) -> Result<AppSettings, String> {
    let mut settings = read_app_settings(&app)?;
    settings.hide_account_notes = enabled;
    write_app_settings(&app, &settings)?;
    Ok(settings)
}

#[tauri::command]
pub(crate) fn set_show_usage_network_errors<R: Runtime>(
    app: AppHandle<R>,
    enabled: bool,
) -> Result<AppSettings, String> {
    let mut settings = read_app_settings(&app)?;
    settings.show_usage_network_errors = enabled;
    write_app_settings(&app, &settings)?;
    Ok(settings)
}

#[tauri::command]
pub(crate) fn set_token_usage_preferences<R: Runtime>(
    app: AppHandle<R>,
    weeks: u16,
    refresh_seconds: u64,
) -> Result<AppSettings, String> {
    if !(MIN_TOKEN_USAGE_WEEKS..=MAX_TOKEN_USAGE_WEEKS).contains(&weeks) {
        return Err(format!(
            "token usage weeks must be between {MIN_TOKEN_USAGE_WEEKS} and {MAX_TOKEN_USAGE_WEEKS}"
        ));
    }
    if !(MIN_TOKEN_USAGE_REFRESH_SECONDS..=MAX_TOKEN_USAGE_REFRESH_SECONDS)
        .contains(&refresh_seconds)
    {
        return Err(format!(
            concat!(
                "token usage refresh interval must be between {} ",
                "and {} seconds"
            ),
            MIN_TOKEN_USAGE_REFRESH_SECONDS,
            MAX_TOKEN_USAGE_REFRESH_SECONDS
        ));
    }

    let mut settings = read_app_settings(&app)?;
    settings.token_usage_weeks = weeks;
    settings.token_usage_refresh_seconds = refresh_seconds;
    write_app_settings(&app, &settings)?;
    Ok(settings)
}

#[tauri::command]
pub(crate) fn set_bubble_reset_display<R: Runtime>(
    app: AppHandle<R>,
    display: BubbleResetDisplay,
) -> Result<AppSettings, String> {
    let mut settings = read_app_settings(&app)?;
    settings.bubble_reset_display = display;
    write_app_settings(&app, &settings)?;
    let event_name = "bubble-reset-display-changed";
    let event_payload = settings.bubble_reset_display.clone();
    app.emit(event_name, event_payload.clone())
        .map_err(|error| error.to_string())?;
    if let Some(window) = app.get_webview_window(BUBBLE_LABEL) {
        window
            .emit(event_name, event_payload)
            .map_err(|error| error.to_string())?;
    }
    Ok(settings)
}

#[tauri::command]
pub(crate) fn set_bubble_style<R: Runtime>(
    app: AppHandle<R>,
    style: BubbleStyle,
) -> Result<AppSettings, String> {
    let mut settings = read_app_settings(&app)?;
    settings.bubble_style = style;
    write_app_settings(&app, &settings)?;
    resize_window_for_style(&app, &settings.bubble_style)?;

    let event_name = "bubble-style-changed";
    let event_payload = settings.bubble_style.clone();
    app.emit(event_name, event_payload.clone())
        .map_err(|error| error.to_string())?;
    if let Some(window) = app.get_webview_window(BUBBLE_LABEL) {
        window
            .emit(event_name, event_payload)
            .map_err(|error| error.to_string())?;
    }
    Ok(settings)
}

#[tauri::command]
pub(crate) fn set_theme_color<R: Runtime>(
    app: AppHandle<R>,
    color: String,
) -> Result<AppSettings, String> {
    if !is_hex_color(&color) {
        return Err("theme color must be a #rrggbb hex value".to_string());
    }
    let normalized = color.to_ascii_lowercase();
    let mut settings = read_app_settings(&app)?;
    settings.theme_color = Some(normalized.clone());
    write_app_settings(&app, &settings)?;
    app.emit("theme-color-changed", normalized)
        .map_err(|error| error.to_string())?;
    Ok(settings)
}

#[tauri::command]
pub(crate) fn set_app_language<R: Runtime>(
    app: AppHandle<R>,
    language: String,
) -> Result<(), String> {
    if !matches!(language.as_str(), "en" | "zh") {
        return Err("language must be en or zh".to_string());
    }
    let mut settings = read_app_settings(&app)?;
    settings.language = Some(language);
    write_app_settings(&app, &settings)?;
    crate::system_tray::refresh_menu(&app);
    Ok(())
}

fn is_hex_color(color: &str) -> bool {
    color.len() == HEX_COLOR_LEN
        && color.starts_with('#')
        && color.chars().skip(1).all(|char| char.is_ascii_hexdigit())
}
