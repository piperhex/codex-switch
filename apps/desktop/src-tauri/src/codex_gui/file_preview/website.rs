//! Unprivileged web content embedded inside the existing conversation window.
use super::{PreviewError, Result};
use serde::Deserialize;
use tauri::{webview::WebviewBuilder, LogicalPosition, LogicalSize, Manager, Webview, WebviewUrl};

const MAX_PREVIEW_EXTENT: f64 = 32_768.0;
pub(super) const LABEL_PREFIX: &str = "main-website-preview-";

#[derive(Clone, Copy, Deserialize)]
pub(crate) struct PreviewBounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WebsitePreviewRequest {
    id: String,
    url: String,
    bounds: PreviewBounds,
    visible: bool,
}

pub(super) fn validate_owner(webview: &Webview) -> Result<()> {
    if webview.label() != "main" {
        return Err(PreviewError::Open);
    }
    Ok(())
}

fn label(webview: &Webview, id: &str) -> Result<String> {
    validate_owner(webview)?;
    let id = uuid::Uuid::parse_str(id).map_err(|_| PreviewError::Open)?;
    Ok(format!("{LABEL_PREFIX}{id}"))
}

fn is_website(url: &url::Url) -> bool {
    matches!(url.scheme(), "http" | "https")
        && url
            .host_str()
            .is_some_and(|host| !matches!(host, "tauri.localhost" | "ipc.localhost"))
}

fn valid_bounds(bounds: PreviewBounds) -> bool {
    [bounds.x, bounds.y, bounds.width, bounds.height]
        .iter()
        .all(|value| value.is_finite() && *value <= MAX_PREVIEW_EXTENT)
        && bounds.x >= 0.0
        && bounds.y >= 0.0
        && bounds.width > 0.0
        && bounds.height > 0.0
}

fn create(webview: &Webview, request: &WebsitePreviewRequest, label: &str) -> Result<Webview> {
    let url = url::Url::parse(&request.url).map_err(|_| PreviewError::Open)?;
    let dev_origin = webview
        .config()
        .build
        .dev_url
        .as_ref()
        .map(|url| url.origin());
    if !is_website(&url) || dev_origin.as_ref() == Some(&url.origin()) {
        return Err(PreviewError::Open);
    }
    // Remote pages receive no IPC capability. Popups navigate this same sidebar instead of opening windows.
    // Adding a child means main-window callers must use Window/Webview, not WebviewWindow.
    let popup_app = webview.app_handle().clone();
    let popup_label = label.to_owned();
    let popup_origin = dev_origin.clone();
    let builder = WebviewBuilder::new(label, WebviewUrl::External(url))
        .on_navigation(move |url| is_website(url) && dev_origin.as_ref() != Some(&url.origin()))
        .on_new_window(move |url, _| {
            if is_website(&url) && popup_origin.as_ref() != Some(&url.origin()) {
                navigate_popup(popup_app.clone(), popup_label.clone(), url);
            }
            tauri::webview::NewWindowResponse::Deny
        })
        .on_download(|_, _| false);
    let bounds = request.bounds;
    webview
        .window()
        .add_child(
            builder,
            LogicalPosition::new(bounds.x, bounds.y),
            LogicalSize::new(bounds.width, bounds.height),
        )
        .map_err(|_| PreviewError::Open)
}

fn navigate_popup(app: tauri::AppHandle, label: String, url: url::Url) {
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(view) = app.get_webview(&label) {
            if let Err(error) = view.navigate(url) {
                eprintln!("website preview navigation failed: {error}");
            }
        }
    });
}

fn sync(webview: &Webview, request: WebsitePreviewRequest) -> Result<()> {
    let label = label(webview, &request.id)?;
    let existing = webview.app_handle().get_webview(&label);
    if !request.visible {
        if let Some(view) = existing {
            view.hide().map_err(|_| PreviewError::Open)?;
        }
        return Ok(());
    }
    if !valid_bounds(request.bounds) {
        return Err(PreviewError::Open);
    }
    let view = match existing {
        Some(view) => view,
        None => create(webview, &request, &label)?,
    };
    let bounds = request.bounds;
    view.set_bounds(tauri::Rect {
        position: LogicalPosition::new(bounds.x, bounds.y).into(),
        size: LogicalSize::new(bounds.width, bounds.height).into(),
    })
    .map_err(|_| PreviewError::Open)?;
    view.show().map_err(|_| PreviewError::Open)
}

/// Serialize requests in the frontend; creation must stay off the Windows UI message thread.
#[tauri::command]
pub(crate) async fn codex_gui_sync_website_preview(
    webview: Webview,
    request: WebsitePreviewRequest,
) -> std::result::Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || sync(&webview, request))
        .await
        .map_err(|_| PreviewError::Open.to_string())?
        .map_err(|error| error.to_string())
}

fn close(webview: &Webview, id: &str) -> Result<()> {
    let label = label(webview, id)?;
    if let Some(view) = webview.app_handle().get_webview(&label) {
        view.close().map_err(|_| PreviewError::Open)?;
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn codex_gui_close_website_preview(
    webview: Webview,
    id: String,
) -> std::result::Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || close(&webview, &id))
        .await
        .map_err(|_| PreviewError::Open.to_string())?
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_loads_websites_without_app_origins() {
        for value in ["https://example.com/page", "http://localhost:3000"] {
            assert!(is_website(&url::Url::parse(value).unwrap()));
        }
        for value in [
            "file:///C:/secret",
            "javascript:alert(1)",
            "tauri://localhost",
            "http://tauri.localhost",
            "http://ipc.localhost",
        ] {
            assert!(!is_website(&url::Url::parse(value).unwrap()));
        }
    }

    #[test]
    fn bounds_must_be_finite_and_visible() {
        let bounds = PreviewBounds {
            x: 600.0,
            y: 120.0,
            width: 560.0,
            height: 600.0,
        };
        assert!(valid_bounds(bounds));
        assert!(!valid_bounds(PreviewBounds {
            width: 0.0,
            ..bounds
        }));
        assert!(!valid_bounds(PreviewBounds { x: -1.0, ..bounds }));
        assert!(!valid_bounds(PreviewBounds {
            width: f64::MAX,
            ..bounds
        }));
        assert!(!valid_bounds(PreviewBounds {
            height: f64::NAN,
            ..bounds
        }));
    }
}
