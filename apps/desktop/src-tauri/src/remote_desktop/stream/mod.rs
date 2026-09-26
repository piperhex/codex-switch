//! Encoded desktop video stays in native WebRTC; only signaling and settings cross the WebView boundary.
#[cfg(windows)]
mod annex_b;
#[cfg(windows)]
mod encoder;
#[cfg(windows)]
mod feedback;
mod model;
#[cfg(windows)]
mod native;
#[cfg(all(test, windows))]
mod native_test;
#[cfg(windows)]
mod peer;
#[cfg(windows)]
mod pump;
#[cfg(windows)]
mod turn_transport;
use super::{safe_error, DesktopError};
pub(crate) use model::*;

#[cfg(windows)]
const MAX_CANDIDATES: usize = 128;
#[cfg(windows)]
static STREAM: tokio::sync::Mutex<Option<std::sync::Arc<native::Stream>>> =
    tokio::sync::Mutex::const_new(None);

#[cfg(windows)]
async fn current(id: &str) -> super::Result<std::sync::Arc<native::Stream>> {
    STREAM
        .lock()
        .await
        .as_ref()
        .filter(|stream| stream.id == id)
        .cloned()
        .ok_or(DesktopError::Expired)
}

#[tauri::command]
pub(crate) async fn remote_desktop_stream_available(app: tauri::AppHandle) -> bool {
    #[cfg(windows)]
    {
        use tauri::Manager;
        let Ok(directory) = app.path().resource_dir() else {
            return false;
        };
        tauri::async_runtime::spawn_blocking(move || encoder::runtime_path(directory).is_ok())
            .await
            .unwrap_or(false)
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        false
    }
}

#[tauri::command]
pub(crate) async fn remote_desktop_stream_open(
    app: tauri::AppHandle,
    request: OpenRequest,
) -> std::result::Result<Offer, String> {
    #[cfg(windows)]
    {
        use tauri::Manager;
        let directory = app
            .path()
            .resource_dir()
            .map_err(|_| safe_error(DesktopError::Platform))?;
        let id = request.id.clone();
        let path = tauri::async_runtime::spawn_blocking(move || {
            super::with_session(&id, || encoder::runtime_path(directory))
        })
        .await
        .map_err(|_| safe_error(DesktopError::Platform))?
        .map_err(safe_error)?;
        let mut active = STREAM.lock().await;
        if active
            .as_ref()
            .is_some_and(|stream| !*stream.cancel.borrow())
        {
            return Err(safe_error(DesktopError::Invalid));
        }
        let (stream, offer) = native::Stream::open(path, request)
            .await
            .map_err(safe_error)?;
        *active = Some(stream);
        Ok(offer)
    }
    #[cfg(not(windows))]
    {
        let _ = (app, request);
        Err(safe_error(DesktopError::Unsupported))
    }
}

#[tauri::command]
pub(crate) async fn remote_desktop_stream_signal(
    request: SignalRequest,
) -> std::result::Result<SignalReply, String> {
    #[cfg(windows)]
    {
        current(&request.id)
            .await
            .map_err(safe_error)?
            .signal(request)
            .await
            .map_err(safe_error)
    }
    #[cfg(not(windows))]
    {
        let _ = request;
        Err(safe_error(DesktopError::Unsupported))
    }
}

#[tauri::command]
pub(crate) async fn remote_desktop_stream_update(
    id: String,
    profile: Profile,
) -> std::result::Result<(), String> {
    #[cfg(windows)]
    {
        let profile = profile.validate().map_err(safe_error)?;
        let stream = current(&id).await.map_err(safe_error)?;
        if *stream.profile.borrow() != profile {
            stream.profile.send_replace(profile);
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = (id, profile);
        Err(safe_error(DesktopError::Unsupported))
    }
}

#[tauri::command]
pub(crate) async fn remote_desktop_stream_status(
    id: String,
) -> std::result::Result<StreamStats, String> {
    #[cfg(windows)]
    {
        Ok(current(&id)
            .await
            .map_err(safe_error)?
            .stats
            .lock()
            .await
            .clone())
    }
    #[cfg(not(windows))]
    {
        let _ = id;
        Err(safe_error(DesktopError::Unsupported))
    }
}

#[tauri::command]
pub(crate) async fn remote_desktop_stream_close(id: String) -> std::result::Result<(), String> {
    #[cfg(windows)]
    {
        let stream = {
            let mut active = STREAM.lock().await;
            if active.as_ref().is_some_and(|stream| stream.id == id) {
                active.take()
            } else {
                None
            }
        };
        if let Some(stream) = stream {
            stream.close().await;
        }
    }
    super::remote_desktop_close(id).await
}
