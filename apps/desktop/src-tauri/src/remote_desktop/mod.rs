//! Screen capture and input run on blocking workers, never the Windows UI thread.
use serde::Deserialize;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

mod validation;
#[cfg(windows)]
mod windows;

#[derive(Debug, thiserror::Error)]
pub(super) enum DesktopError {
    #[error("invalid desktop request")]
    Invalid,
    #[error("desktop session expired")]
    Expired,
    #[error("desktop capture or input failed")]
    Platform,
    #[error("desktop platform unsupported")]
    #[cfg(not(windows))]
    Unsupported,
}
type Result<T> = std::result::Result<T, DesktopError>;
const LEASE: Duration = Duration::from_secs(15);
struct Session {
    id: String,
    touched: Instant,
}
static SESSION: OnceLock<Mutex<Option<Session>>> = OnceLock::new();

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum DesktopInput {
    Move { x: f64, y: f64 },
    Button { button: Button, down: bool },
    Wheel { delta: i32 },
    Text { text: String },
    Key { key: Key },
}
#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Button {
    Left,
    Right,
}
#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Key {
    Enter,
    Backspace,
    Escape,
    Tab,
    Desktop,
    Windows,
}

fn safe_error(error: DesktopError) -> String {
    match error {
        #[cfg(not(windows))]
        DesktopError::Unsupported => "这台电脑暂不支持远程桌面，请使用 Windows 电脑。",
        DesktopError::Expired => "桌面连接已结束，请重新连接。",
        DesktopError::Invalid => "远程操作无效，请重试。",
        DesktopError::Platform => "无法访问桌面，请确认电脑已解锁后重试。",
    }
    .into()
}

fn with_session<T>(id: &str, operation: impl FnOnce() -> Result<T>) -> Result<T> {
    let mut guard = SESSION
        .get_or_init(|| Mutex::new(None))
        .lock()
        .map_err(|_| DesktopError::Platform)?;
    let session = guard
        .as_mut()
        .filter(|session| session.id == id)
        .ok_or(DesktopError::Expired)?;
    if session.touched.elapsed() > LEASE {
        return Err(DesktopError::Expired);
    }
    session.touched = Instant::now();
    operation()
}

fn open() -> Result<String> {
    #[cfg(not(windows))]
    return Err(DesktopError::Unsupported);
    #[cfg(windows)]
    {
        let mut guard = SESSION
            .get_or_init(|| Mutex::new(None))
            .lock()
            .map_err(|_| DesktopError::Platform)?;
        if guard.is_some() {
            windows::release_buttons()?;
        }
        let id = uuid::Uuid::new_v4().to_string();
        *guard = Some(Session {
            id: id.clone(),
            touched: Instant::now(),
        });
        let watched = id.clone();
        std::thread::spawn(move || expire(watched));
        Ok(id)
    }
}

#[cfg(windows)]
fn expire(id: String) {
    loop {
        std::thread::sleep(Duration::from_secs(1));
        let Ok(mut guard) = SESSION.get_or_init(|| Mutex::new(None)).lock() else {
            return;
        };
        let Some(session) = guard.as_ref().filter(|session| session.id == id) else {
            return;
        };
        if session.touched.elapsed() <= LEASE {
            continue;
        }
        if let Err(error) = windows::release_buttons() {
            eprintln!("desktop input cleanup: {error}");
        }
        *guard = None;
        return;
    }
}

fn close(id: &str) -> Result<()> {
    let mut guard = SESSION
        .get_or_init(|| Mutex::new(None))
        .lock()
        .map_err(|_| DesktopError::Platform)?;
    if guard.as_ref().is_some_and(|session| session.id == id) {
        #[cfg(windows)]
        windows::release_buttons()?;
        *guard = None;
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn remote_desktop_open() -> std::result::Result<String, String> {
    tauri::async_runtime::spawn_blocking(open)
        .await
        .map_err(|_| safe_error(DesktopError::Platform))?
        .map_err(safe_error)
}

#[tauri::command]
pub(crate) async fn remote_desktop_frame(
    id: String,
    width: u32,
) -> std::result::Result<tauri::ipc::Response, String> {
    tauri::async_runtime::spawn_blocking(move || {
        validation::width(width)?;
        with_session(&id, || Ok(()))?;
        #[cfg(windows)]
        return windows::capture(width).map(tauri::ipc::Response::new);
        #[cfg(not(windows))]
        Err(DesktopError::Unsupported)
    })
    .await
    .map_err(|_| safe_error(DesktopError::Platform))?
    .map_err(safe_error)
}

#[tauri::command]
pub(crate) async fn remote_desktop_input(
    id: String,
    input: DesktopInput,
) -> std::result::Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        validation::input(&input)?;
        with_session(&id, || {
            #[cfg(windows)]
            return windows::input(input);
            #[cfg(not(windows))]
            Err(DesktopError::Unsupported)
        })
    })
    .await
    .map_err(|_| safe_error(DesktopError::Platform))?
    .map_err(safe_error)
}

#[tauri::command]
pub(crate) async fn remote_desktop_close(id: String) -> std::result::Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || close(&id))
        .await
        .map_err(|_| safe_error(DesktopError::Platform))?
        .map_err(safe_error)
}
