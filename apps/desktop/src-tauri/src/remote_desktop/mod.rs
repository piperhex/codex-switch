//! Screen capture and input run on blocking workers, never the Windows UI thread.
use serde::Deserialize;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

pub(crate) mod clipboard;
mod clipboard_files;
mod clipboard_platform;
pub(crate) mod displays;
#[cfg(windows)]
pub(crate) mod input_desktop;
mod keyboard;
mod lease;
pub(crate) mod local_clipboard;
#[cfg(windows)]
mod monitors;
pub(crate) mod permissions;
#[cfg(windows)]
pub(crate) mod service_worker;
pub(crate) mod stream;
mod validation;
#[cfg(windows)]
mod windows;
#[cfg(windows)]
mod windows_input;

#[derive(Debug, thiserror::Error)]
pub(super) enum DesktopError {
    #[error("desktop session already active")]
    Busy,
    #[error("desktop permission denied")]
    Denied,
    #[error("invalid desktop request")]
    Invalid,
    #[error("desktop session expired")]
    Expired,
    #[error("desktop capture or input failed")]
    Platform,
    #[error("selected desktop display disconnected")]
    DisplayGone,
    #[error("desktop platform unsupported")]
    #[cfg(not(windows))]
    Unsupported,
}
type Result<T> = std::result::Result<T, DesktopError>;
const LEASE: Duration = Duration::from_secs(15);
struct Session {
    permissions: permissions::Permissions,
    id: String,
    touched: Instant,
    deadline: Instant,
    clipboard: Option<clipboard::Transfer>,
    #[cfg(windows)]
    display: monitors::Monitor,
    #[cfg(windows)]
    input: windows_input::InputState,
}
static SESSION: OnceLock<Mutex<Option<Session>>> = OnceLock::new();

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum DesktopInput {
    Move {
        x: f64,
        y: f64,
    },
    Button {
        button: Button,
        down: bool,
    },
    Wheel {
        delta: i32,
        #[serde(default)]
        horizontal: bool,
    },
    Text {
        text: String,
    },
    Key {
        key: Key,
    },
    Keyboard {
        code: keyboard::KeyboardKey,
        down: bool,
    },
}
#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Button {
    Left,
    Right,
    Middle,
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
        DesktopError::Busy => "已有远程桌面连接，请先关闭后再试。",
        DesktopError::Denied => "这台电脑未允许此远程操作，请在电脑的设置中调整。",
        #[cfg(not(windows))]
        DesktopError::Unsupported => "这台电脑暂不支持远程桌面，请使用 Windows 电脑。",
        DesktopError::Expired => "桌面连接已结束，请重新连接。",
        DesktopError::Invalid => "远程操作无效，请重试。",
        DesktopError::Platform => "暂时无法访问桌面，请稍后重试。",
        DesktopError::DisplayGone => "显示器已断开，请重新连接桌面。",
    }
    .into()
}

fn with_session<T>(id: &str, operation: impl FnOnce(&mut Session) -> Result<T>) -> Result<T> {
    #[cfg(windows)]
    let _desktop = input_desktop::InputDesktop::enter()?;
    let mut guard = SESSION
        .get_or_init(|| Mutex::new(None))
        .lock()
        .map_err(|_| DesktopError::Platform)?;
    let session = guard
        .as_mut()
        .filter(|session| session.id == id)
        .ok_or(DesktopError::Expired)?;
    if session.touched.elapsed() > LEASE || Instant::now() >= session.deadline {
        return Err(DesktopError::Expired);
    }
    session.touched = Instant::now();
    operation(session)
}

fn open(
    display_id: Option<String>,
    permissions: permissions::Permissions,
    expires_at: Option<u64>,
) -> Result<displays::Opened> {
    #[cfg(windows)]
    let _desktop = input_desktop::InputDesktop::enter()?;
    if !permissions.enabled {
        return Err(DesktopError::Denied);
    }
    #[cfg(not(windows))]
    return Err(DesktopError::Unsupported);
    #[cfg(windows)]
    {
        if display_id
            .as_ref()
            .is_some_and(|id| id.is_empty() || id.len() > 128)
        {
            return Err(DesktopError::Invalid);
        }
        let monitors = monitors::list()?;
        let display = monitors::select(&monitors, display_id.as_deref())?;
        let display_id = display.info.id.clone();
        let mut guard = SESSION
            .get_or_init(|| Mutex::new(None))
            .lock()
            .map_err(|_| DesktopError::Platform)?;
        if let Some(session) = guard.as_mut() {
            if session.touched.elapsed() <= LEASE && Instant::now() < session.deadline {
                return Err(DesktopError::Busy);
            }
            session.input.release()?;
        }
        let id = uuid::Uuid::new_v4().to_string();
        *guard = Some(Session {
            permissions,
            id: id.clone(),
            touched: Instant::now(),
            deadline: lease::deadline(expires_at)?,
            clipboard: None,
            display,
            input: windows_input::InputState::default(),
        });
        let watched = id.clone();
        std::thread::spawn(move || expire(watched));
        Ok(displays::Opened {
            permissions,
            id,
            display_id,
            displays: monitors.into_iter().map(|monitor| monitor.info).collect(),
        })
    }
}

#[cfg(windows)]
fn expire(id: String) {
    loop {
        std::thread::sleep(Duration::from_secs(1));
        let Ok(mut guard) = SESSION.get_or_init(|| Mutex::new(None)).lock() else {
            return;
        };
        let Some(session) = guard.as_mut().filter(|session| session.id == id) else {
            return;
        };
        if session.touched.elapsed() <= LEASE && Instant::now() < session.deadline {
            continue;
        }
        let _desktop = match input_desktop::InputDesktop::enter() {
            Ok(desktop) => Some(desktop),
            Err(error) => {
                eprintln!("desktop cleanup context: {error}");
                None
            }
        };
        if let Err(error) = session.input.release() {
            eprintln!("desktop input cleanup: {error}");
        }
        *guard = None;
        return;
    }
}

fn revoke() -> Result<()> {
    #[cfg(windows)]
    let _desktop = input_desktop::InputDesktop::enter()?;
    let mut guard = SESSION
        .get_or_init(|| Mutex::new(None))
        .lock()
        .map_err(|_| DesktopError::Platform)?;
    if let Some(session) = guard.as_mut() {
        #[cfg(windows)]
        session.input.release()?;
    }
    *guard = None;
    Ok(())
}

fn close(id: &str) -> Result<()> {
    #[cfg(windows)]
    let _desktop = input_desktop::InputDesktop::enter()?;
    let mut guard = SESSION
        .get_or_init(|| Mutex::new(None))
        .lock()
        .map_err(|_| DesktopError::Platform)?;
    if let Some(session) = guard.as_mut().filter(|session| session.id == id) {
        #[cfg(windows)]
        session.input.release()?;
        *guard = None;
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn remote_desktop_open(
    app: tauri::AppHandle,
    display_id: Option<String>,
    expires_at: Option<u64>,
) -> std::result::Result<displays::Opened, String> {
    #[cfg(windows)]
    if let Some(opened) =
        crate::desktop_service::delegation::open(display_id.clone(), expires_at).await?
    {
        return Ok(opened);
    }
    tauri::async_runtime::spawn_blocking(move || permissions::open(&app, display_id, expires_at))
        .await
        .map_err(|_| safe_error(DesktopError::Platform))?
        .map_err(safe_error)
}

#[tauri::command]
pub(crate) async fn remote_desktop_renew(
    id: String,
    expires_at: u64,
) -> std::result::Result<(), String> {
    #[cfg(windows)]
    if crate::desktop_service::delegation::delegated(&id) {
        return crate::desktop_service::delegation::call(
            "remote_desktop_renew",
            &id,
            serde_json::json!({"expiresAt": expires_at}),
        )
        .await;
    }
    tauri::async_runtime::spawn_blocking(move || {
        with_session(&id, |session| {
            session.deadline = lease::deadline(Some(expires_at))?;
            Ok(())
        })
    })
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
        #[cfg(windows)]
        return with_session(&id, |session| windows::capture(width, &session.display))
            .map(tauri::ipc::Response::new);
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
        with_session(&id, |session| {
            if !session.permissions.control {
                return Err(DesktopError::Denied);
            }
            #[cfg(windows)]
            return session.input.apply(input, &session.display);
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
    #[cfg(windows)]
    if crate::desktop_service::delegation::delegated(&id) {
        return crate::desktop_service::delegation::call(
            "remote_desktop_close",
            &id,
            serde_json::json!({}),
        )
        .await;
    }
    tauri::async_runtime::spawn_blocking(move || close(&id))
        .await
        .map_err(|_| safe_error(DesktopError::Platform))?
        .map_err(safe_error)
}
