#[tauri::command]
pub(crate) fn resize_floating_bubble<R: Runtime>(
    app: AppHandle<R>,
    expanded: bool,
) -> Result<(), String> {
    let window = app
        .get_webview_window(BUBBLE_LABEL)
        .ok_or_else(|| "悬浮球窗口不存在".to_string())?;
    let scale = window.scale_factor().map_err(|error| error.to_string())?;
    let position = window
        .outer_position()
        .map_err(|error| error.to_string())?
        .to_logical::<f64>(scale);
    let size = window
        .inner_size()
        .map_err(|error| error.to_string())?
        .to_logical::<f64>(scale);
    let anchor_x = position.x + size.width - CLASSIC_WIDTH;
    let anchor_y = position.y + size.height - CLASSIC_HEIGHT;
    let (width, height) = if expanded {
        (EXPANDED_WIDTH, EXPANDED_HEIGHT)
    } else {
        (CLASSIC_WIDTH, CLASSIC_HEIGHT)
    };

    window
        .set_size(LogicalSize::new(width, height))
        .map_err(|error| error.to_string())?;
    window
        .set_position(LogicalPosition::new(
            anchor_x - (width - CLASSIC_WIDTH),
            anchor_y - (height - CLASSIC_HEIGHT),
        ))
        .map_err(|error| error.to_string())
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum FloatingUsageWindowMode {
    Classic,
    Glass,
    ProviderCard,
    ConcurrentCard,
}

#[tauri::command]
pub(crate) async fn resize_floating_usage_window<R: Runtime>(
    app: AppHandle<R>,
    mode: FloatingUsageWindowMode,
) -> Result<(), String> {
    let target_size = floating_usage_window_size(mode);
    tauri::async_runtime::spawn_blocking(move || resize_window(&app, target_size))
        .await
        .map_err(|error| error.to_string())?
}

fn floating_usage_window_size(mode: FloatingUsageWindowMode) -> (f64, f64) {
    match mode {
        FloatingUsageWindowMode::Classic => (CLASSIC_WIDTH, CLASSIC_HEIGHT),
        FloatingUsageWindowMode::Glass | FloatingUsageWindowMode::ProviderCard => {
            (GLASS_WIDTH, GLASS_HEIGHT)
        }
        FloatingUsageWindowMode::ConcurrentCard => {
            (CONCURRENT_CARD_WIDTH, CONCURRENT_CARD_HEIGHT)
        }
    }
}

fn bubble_size(style: &BubbleStyle) -> (f64, f64) {
    match style {
        BubbleStyle::Classic => (CLASSIC_WIDTH, CLASSIC_HEIGHT),
        BubbleStyle::Glass => (GLASS_WIDTH, GLASS_HEIGHT),
    }
}

fn resize_window_for_style<R: Runtime>(
    app: &AppHandle<R>,
    style: &BubbleStyle,
) -> Result<(), String> {
    resize_window(app, bubble_size(style))
}

fn resize_window<R: Runtime>(app: &AppHandle<R>, target_size: (f64, f64)) -> Result<(), String> {
    let Some(window) = app.get_webview_window(BUBBLE_LABEL) else {
        return Ok(());
    };
    let scale = window.scale_factor().map_err(|error| error.to_string())?;
    let position = window
        .outer_position()
        .map_err(|error| error.to_string())?
        .to_logical::<f64>(scale);
    let current_size = window
        .inner_size()
        .map_err(|error| error.to_string())?
        .to_logical::<f64>(scale);
    let (width, height) = target_size;
    window
        .set_size(LogicalSize::new(width, height))
        .map_err(|error| error.to_string())?;
    window
        .set_position(LogicalPosition::new(
            position.x + current_size.width - width,
            position.y + current_size.height - height,
        ))
        .map_err(|error| error.to_string())
}
