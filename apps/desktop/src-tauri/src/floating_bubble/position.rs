use std::{sync::atomic::Ordering, thread, time::Duration};

use tauri::{AppHandle, Manager, Runtime, Window};

use super::{
    lifecycle::BubbleLifecycle, read_app_settings, write_app_settings, BUBBLE_LABEL,
    CLASSIC_HEIGHT, CLASSIC_WIDTH,
};

const POSITION_SAVE_DELAY: Duration = Duration::from_millis(250);

pub(super) fn remember<R: Runtime>(window: &Window<R>) {
    let state = window.state::<BubbleLifecycle>();
    state.position_revision.fetch_add(1, Ordering::AcqRel);
    if state.position_saving.swap(true, Ordering::AcqRel) {
        return;
    }
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || save_when_settled(&app));
}

fn save_when_settled<R: Runtime>(app: &AppHandle<R>) {
    let state = app.state::<BubbleLifecycle>();
    loop {
        let revision = state.position_revision.load(Ordering::Acquire);
        thread::sleep(POSITION_SAVE_DELAY);
        if state.position_revision.load(Ordering::Acquire) != revision {
            continue;
        }
        if let Err(error) = save(app) {
            eprintln!("failed to save floating usage window position: {error}");
        }
        state.position_saving.store(false, Ordering::Release);
        // A move can arrive during the save. Hand it to an existing worker or keep this one alive.
        if state.position_revision.load(Ordering::Acquire) == revision
            || state.position_saving.swap(true, Ordering::AcqRel)
        {
            return;
        }
    }
}

fn save<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let state = app.state::<BubbleLifecycle>();
    let _guard = state.operation.lock().map_err(|error| error.to_string())?;
    let Some(window) = app.get_webview_window(BUBBLE_LABEL) else {
        return Ok(());
    };
    let scale = window.scale_factor().map_err(|error| error.to_string())?;
    let position = window
        .outer_position()
        .map_err(|error| error.to_string())?
        .to_logical::<f64>(scale);
    let size = window
        .inner_size()
        .map_err(|error| error.to_string())?
        .to_logical::<f64>(scale);
    let mut settings = read_app_settings(app)?;
    settings.bubble_x = Some(position.x + size.width - CLASSIC_WIDTH);
    settings.bubble_y = Some(position.y + size.height - CLASSIC_HEIGHT);
    write_app_settings(app, &settings)
}
