use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tokio::sync::Mutex;
use url::Url;
use uuid::Uuid;

const NAVIGATION_EVENT: &str = "codex-gui-open-thread";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ThreadNavigation {
    request_id: String,
    thread_id: String,
}

/// Retain clicks until the main renderer subscribes, including cold application startup.
#[derive(Default)]
pub(crate) struct NavigationState(Mutex<Option<ThreadNavigation>>);

#[cfg(any(windows, test))]
pub(super) fn thread_url(thread_id: &str) -> String {
    let query: String = url::form_urlencoded::Serializer::new(String::new())
        .append_pair("threadId", thread_id)
        .finish();
    format!("cswitch://codex-gui/thread?{query}")
}

fn parse_thread_url(url: &Url) -> Option<String> {
    if url.scheme() != "cswitch"
        || url.host_str() != Some("codex-gui")
        || url.path() != "/thread"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || url.fragment().is_some()
    {
        return None;
    }
    let pairs: Vec<_> = url.query_pairs().collect();
    let [(key, thread_id)] = pairs.as_slice() else {
        return None;
    };
    if key != "threadId" {
        return None;
    }
    let id = Uuid::parse_str(thread_id).ok()?;
    (id.to_string() == thread_id.as_ref()).then(|| thread_id.to_string())
}

/// Route validated conversation links separately from provider imports.
pub(crate) fn handle_url<R: Runtime>(app: &AppHandle<R>, url: &Url) {
    let Some(thread_id) = parse_thread_url(url) else {
        crate::ccs_import::handle_url(app, url);
        return;
    };
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let state = app.state::<NavigationState>();
        *state.0.lock().await = Some(ThreadNavigation {
            request_id: Uuid::new_v4().to_string(),
            thread_id,
        });
        crate::system_tray::show_dashboard(&app);
        if app.emit_to("main", NAVIGATION_EVENT, ()).is_err() {
            eprintln!("Codex GUI could not announce a conversation notification click");
        }
    });
}

#[tauri::command]
pub(crate) async fn codex_gui_take_notification_navigation(
    state: State<'_, NavigationState>,
) -> Result<Option<ThreadNavigation>, String> {
    Ok(state.0.lock().await.take())
}

#[cfg(test)]
mod tests {
    use super::*;
    const THREAD: &str = "01a0e75e-3c32-7f23-9131-e54d7c49e7f8";

    #[test]
    fn only_valid_conversation_links_are_accepted() {
        let valid = thread_url(THREAD);
        assert_eq!(
            parse_thread_url(&Url::parse(&valid).unwrap()),
            Some(THREAD.into())
        );
        for invalid in [
            valid.replace("cswitch:", "https:"),
            valid.replace("/thread", "/other"),
            valid.replace(THREAD, "../file"),
            valid.replace("codex-gui", "other"),
            format!("{valid}&threadId={THREAD}"),
            format!("{valid}#extra"),
            format!("{valid}&extra=value"),
            "cswitch://codex-gui/thread".into(),
        ] {
            assert_eq!(
                parse_thread_url(&Url::parse(&invalid).unwrap()),
                None,
                "{invalid}"
            );
        }
    }
}
