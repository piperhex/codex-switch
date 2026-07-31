use std::{fs, path::PathBuf, sync::Mutex};

use serde::{Deserialize, Serialize};
use tauri::{
    App, AppHandle, LogicalSize, Manager, PhysicalPosition, PhysicalSize, Runtime, Window,
};

const STATE_FILE_NAME: &str = "main-window-state.json";
const DEFAULT_HEIGHT: f64 = 760.0;
const DEFAULT_WIDTH_RATIO: f64 = 0.8;
const MAX_DEFAULT_WIDTH: f64 = 1600.0;
const MIN_WIDTH: f64 = 960.0;
const MIN_HEIGHT: f64 = 680.0;
const SCREEN_MARGIN: f64 = 24.0;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
struct MainWindowState {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    #[serde(default)]
    maximized: bool,
}

#[derive(Clone, Copy, Debug)]
struct WorkArea {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

#[derive(Default)]
pub(crate) struct MainWindowStateCache(Mutex<Option<MainWindowState>>);

pub(crate) fn restore_or_set_default<R: Runtime>(app: &App<R>) -> tauri::Result<()> {
    let Some(window) = app.get_webview_window("main") else {
        return Ok(());
    };

    #[cfg(target_os = "windows")]
    window.set_decorations(false)?;

    let restored = load(app.handle())
        .and_then(|state| fit_to_available_screens(state, &window.available_monitors().ok()?));

    let state = if let Some(state) = restored {
        window.set_size(PhysicalSize::new(state.width, state.height))?;
        window.set_position(PhysicalPosition::new(state.x, state.y))?;
        if state.maximized {
            window.maximize()?;
        }
        state
    } else {
        set_default_size(app, &window)?;
        capture_webview_window(&window).unwrap_or(MainWindowState {
            x: 0,
            y: 0,
            width: MIN_WIDTH as u32,
            height: DEFAULT_HEIGHT as u32,
            maximized: false,
        })
    };

    *app.state::<MainWindowStateCache>()
        .0
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(state);
    Ok(())
}

fn set_default_size<R: Runtime>(
    app: &App<R>,
    window: &tauri::WebviewWindow<R>,
) -> tauri::Result<()> {
    let Some(monitor) = window.current_monitor()?.or(app.primary_monitor()?) else {
        return Ok(());
    };
    let work_area = monitor.work_area();
    let screen = work_area.size.to_logical::<f64>(monitor.scale_factor());
    let max_width = (screen.width - SCREEN_MARGIN * 2.0).max(MIN_WIDTH);
    let max_height = (screen.height - SCREEN_MARGIN * 2.0).max(MIN_HEIGHT);
    let width = (screen.width * DEFAULT_WIDTH_RATIO)
        .clamp(MIN_WIDTH, max_width)
        .min(MAX_DEFAULT_WIDTH);
    let height = DEFAULT_HEIGHT.min(max_height);

    window.set_size(LogicalSize::new(width, height))?;
    window.center()
}

pub(crate) fn remember<R: Runtime>(window: &Window<R>) {
    if window.is_minimized().unwrap_or(false) {
        return;
    }

    let maximized = window.is_maximized().unwrap_or(false);
    let cache = window.state::<MainWindowStateCache>();
    let mut cached = cache
        .0
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());

    if maximized {
        if let Some(state) = cached.as_mut() {
            state.maximized = true;
        }
        return;
    }

    if let Some(state) = capture_window(window) {
        *cached = Some(state);
    }
}

pub(crate) fn remember_and_save<R: Runtime>(window: &Window<R>) {
    remember(window);
    if let Err(error) = save_cached(window.app_handle()) {
        eprintln!("failed to save main window state: {error}");
    }
}

pub(crate) fn save_cached<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let state = *app
        .state::<MainWindowStateCache>()
        .0
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let Some(state) = state else {
        return Ok(());
    };
    let value = serde_json::to_value(state)
        .map_err(|error| format!("failed to serialize main window state: {error}"))?;
    crate::storage::write_json_atomic(&state_path(app)?, &value)
}

fn load<R: Runtime>(app: &AppHandle<R>) -> Option<MainWindowState> {
    let bytes = fs::read(state_path(app).ok()?).ok()?;
    let state = serde_json::from_slice::<MainWindowState>(&bytes).ok()?;
    is_sane(state).then_some(state)
}

fn state_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join(STATE_FILE_NAME))
        .map_err(|error| format!("failed to locate app data directory: {error}"))
}

fn capture_window<R: Runtime>(window: &Window<R>) -> Option<MainWindowState> {
    let position = window.outer_position().ok()?;
    let size = window.inner_size().ok()?;
    let state = MainWindowState {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
        maximized: false,
    };
    is_sane(state).then_some(state)
}

fn capture_webview_window<R: Runtime>(window: &tauri::WebviewWindow<R>) -> Option<MainWindowState> {
    let position = window.outer_position().ok()?;
    let size = window.inner_size().ok()?;
    let state = MainWindowState {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
        maximized: window.is_maximized().unwrap_or(false),
    };
    is_sane(state).then_some(state)
}

fn is_sane(state: MainWindowState) -> bool {
    (MIN_WIDTH as u32..=32_768).contains(&state.width)
        && (MIN_HEIGHT as u32..=32_768).contains(&state.height)
}

fn fit_to_available_screens(
    state: MainWindowState,
    monitors: &[tauri::Monitor],
) -> Option<MainWindowState> {
    let work_areas = monitors
        .iter()
        .map(|monitor| {
            let area = monitor.work_area();
            WorkArea {
                x: area.position.x,
                y: area.position.y,
                width: area.size.width,
                height: area.size.height,
            }
        })
        .collect::<Vec<_>>();
    fit_to_work_areas(state, &work_areas)
}

fn fit_to_work_areas(state: MainWindowState, work_areas: &[WorkArea]) -> Option<MainWindowState> {
    if !is_sane(state) || work_areas.is_empty() {
        return None;
    }

    let window_area = i64::from(state.width) * i64::from(state.height);
    let intersections = work_areas
        .iter()
        .map(|area| intersection_area(state, *area))
        .collect::<Vec<_>>();
    let visible_area = intersections
        .iter()
        .copied()
        .fold(0_i64, i64::saturating_add);

    if visible_area >= window_area {
        return Some(state);
    }

    let (target_index, target_intersection) = intersections
        .iter()
        .copied()
        .enumerate()
        .max_by_key(|(_, area)| *area)?;
    if target_intersection == 0 {
        return None;
    }

    let target = work_areas[target_index];
    let width = state.width.min(target.width);
    let height = state.height.min(target.height);
    let min_x = i64::from(target.x);
    let min_y = i64::from(target.y);
    let max_x = min_x + i64::from(target.width.saturating_sub(width));
    let max_y = min_y + i64::from(target.height.saturating_sub(height));

    Some(MainWindowState {
        x: i64::from(state.x).clamp(min_x, max_x) as i32,
        y: i64::from(state.y).clamp(min_y, max_y) as i32,
        width,
        height,
        maximized: state.maximized,
    })
}

fn intersection_area(state: MainWindowState, area: WorkArea) -> i64 {
    let left = i64::from(state.x).max(i64::from(area.x));
    let top = i64::from(state.y).max(i64::from(area.y));
    let right = (i64::from(state.x) + i64::from(state.width))
        .min(i64::from(area.x) + i64::from(area.width));
    let bottom = (i64::from(state.y) + i64::from(state.height))
        .min(i64::from(area.y) + i64::from(area.height));
    (right - left).max(0) * (bottom - top).max(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state(x: i32, y: i32, width: u32, height: u32) -> MainWindowState {
        MainWindowState {
            x,
            y,
            width,
            height,
            maximized: false,
        }
    }

    #[test]
    fn keeps_a_window_that_is_visible_across_multiple_screens() {
        let screens = [
            WorkArea {
                x: 0,
                y: 0,
                width: 1920,
                height: 1040,
            },
            WorkArea {
                x: 1920,
                y: 0,
                width: 1920,
                height: 1040,
            },
        ];
        let saved = state(1500, 100, 1000, 700);

        assert_eq!(fit_to_work_areas(saved, &screens), Some(saved));
    }

    #[test]
    fn moves_and_shrinks_a_window_after_resolution_changes() {
        let screens = [WorkArea {
            x: 0,
            y: 0,
            width: 1920,
            height: 1040,
        }];
        let saved = state(1200, 400, 2560, 1400);

        assert_eq!(
            fit_to_work_areas(saved, &screens),
            Some(state(0, 0, 1920, 1040))
        );
    }

    #[test]
    fn rejects_a_window_from_a_disconnected_screen() {
        let screens = [WorkArea {
            x: 0,
            y: 0,
            width: 1920,
            height: 1040,
        }];

        assert_eq!(
            fit_to_work_areas(state(2500, 100, 1000, 700), &screens),
            None
        );
    }

    #[test]
    fn rejects_a_window_smaller_than_the_configured_minimum() {
        assert_eq!(
            fit_to_work_areas(
                state(100, 100, MIN_WIDTH as u32 - 1, MIN_HEIGHT as u32),
                &[WorkArea {
                    x: 0,
                    y: 0,
                    width: 1920,
                    height: 1040,
                }],
            ),
            None
        );
        assert_eq!(
            fit_to_work_areas(
                state(100, 100, MIN_WIDTH as u32, MIN_HEIGHT as u32 - 1),
                &[WorkArea {
                    x: 0,
                    y: 0,
                    width: 1920,
                    height: 1040,
                }],
            ),
            None
        );
    }
}
