use tauri::{
    webview::Color, AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Runtime, WebviewUrl,
    WebviewWindowBuilder, Window,
};

use crate::{
    models::{
        AppSettings, BubbleResetDisplay, BubbleStyle, MAX_TOKEN_USAGE_REFRESH_SECONDS,
        MAX_TOKEN_USAGE_WEEKS, MIN_TOKEN_USAGE_REFRESH_SECONDS, MIN_TOKEN_USAGE_WEEKS,
    },
    storage::{read_app_settings, write_app_settings},
};

pub(crate) const BUBBLE_LABEL: &str = "usage-bubble";
const CLASSIC_WIDTH: f64 = 108.0;
const CLASSIC_HEIGHT: f64 = 108.0;
const GLASS_WIDTH: f64 = 232.0;
const GLASS_HEIGHT: f64 = 112.0;
const CONCURRENT_CARD_WIDTH: f64 = 280.0;
const CONCURRENT_CARD_HEIGHT: f64 = 126.0;
const EXPANDED_WIDTH: f64 = 304.0;
const EXPANDED_HEIGHT: f64 = 298.0;
const SCREEN_MARGIN: f64 = 22.0;
const HEX_COLOR_LEN: usize = 7;

pub(crate) fn setup<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let settings = read_app_settings(app)?;
    if settings.floating_bubble_enabled {
        create(app, &settings)?;
    }
    Ok(())
}

fn create<R: Runtime>(app: &AppHandle<R>, settings: &AppSettings) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(BUBBLE_LABEL) {
        window.show().map_err(|error| error.to_string())?;
        return Ok(());
    }

    let (x, y) = restored_or_default_position(app, settings);
    let window = WebviewWindowBuilder::new(
        app,
        BUBBLE_LABEL,
        WebviewUrl::App("index.html#bubble".into()),
    )
    .title("Codex Usage")
    .inner_size(
        bubble_size(&settings.bubble_style).0,
        bubble_size(&settings.bubble_style).1,
    )
    .position(x, y)
    .resizable(false)
    .maximizable(false)
    .minimizable(false)
    .closable(false)
    .decorations(false)
    .transparent(true)
    .background_color(Color(0, 0, 0, 0))
    .shadow(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .focused(false)
    .build()
    .map_err(|error| error.to_string())?;
    window.on_menu_event(|window, event| {
        crate::system_tray::handle_menu_event(window.app_handle(), event);
    });
    Ok(())
}

fn restored_or_default_position<R: Runtime>(
    app: &AppHandle<R>,
    settings: &AppSettings,
) -> (f64, f64) {
    if let (Some(x), Some(y)) = (settings.bubble_x, settings.bubble_y) {
        if position_is_visible(app, x, y) {
            return (x, y);
        }
    }

    let monitor = app
        .get_webview_window("main")
        .and_then(|window| window.current_monitor().ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten());
    let Some(monitor) = monitor else {
        return (SCREEN_MARGIN, SCREEN_MARGIN);
    };
    let area = monitor.work_area();
    let position = area.position.to_logical::<f64>(monitor.scale_factor());
    let size = area.size.to_logical::<f64>(monitor.scale_factor());
    (
        position.x + size.width - bubble_size(&settings.bubble_style).0 - SCREEN_MARGIN,
        position.y + size.height - bubble_size(&settings.bubble_style).1 - SCREEN_MARGIN,
    )
}

fn position_is_visible<R: Runtime>(app: &AppHandle<R>, x: f64, y: f64) -> bool {
    app.available_monitors().is_ok_and(|monitors| {
        monitors.into_iter().any(|monitor| {
            let area = monitor.work_area();
            let position = area.position.to_logical::<f64>(monitor.scale_factor());
            let size = area.size.to_logical::<f64>(monitor.scale_factor());
            x + CLASSIC_WIDTH > position.x
                && x < position.x + size.width
                && y + CLASSIC_HEIGHT > position.y
                && y < position.y + size.height
        })
    })
}
