//! Browser previews use the listener's origin and an unguessable, file-scoped capability.
use super::{
    content, file_actions, server, FileTarget, GuiState, PreviewData, PreviewError,
    PreviewSessions, Result,
};
use std::{
    collections::HashMap,
    path::Path,
    sync::Arc,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager};
use tiny_http::{Request, Response, ResponseBox, StatusCode};

pub(crate) const PATH_PREFIX: &str = "/__codex_switch__/file-preview/";
const IDLE_TIMEOUT: Duration = Duration::from_secs(60 * 60);
const MAX_SESSIONS: usize = 128;

struct HostedSession {
    scope: Arc<server::Scope>,
    last_used: Instant,
}

#[derive(Default)]
pub(super) struct HostedSessions(HashMap<String, HostedSession>);

impl HostedSessions {
    fn prune(&mut self) {
        self.0
            .retain(|_, session| session.last_used.elapsed() < IDLE_TIMEOUT);
    }

    fn insert(&mut self, id: String, scope: server::Scope) {
        self.prune();
        if self.0.len() >= MAX_SESSIONS {
            if let Some(oldest) = self
                .0
                .iter()
                .min_by_key(|(_, session)| session.last_used)
                .map(|(id, _)| id.clone())
            {
                self.0.remove(&oldest);
            }
        }
        self.0.insert(
            id,
            HostedSession {
                scope: Arc::new(scope),
                last_used: Instant::now(),
            },
        );
    }

    fn scope(&mut self, url: &str) -> Option<Arc<server::Scope>> {
        self.prune();
        let (id, _) = url.strip_prefix(PATH_PREFIX)?.split_once('/')?;
        let session = self.0.get_mut(id)?;
        session.last_used = Instant::now();
        Some(Arc::clone(&session.scope))
    }
}

/// Only the authenticated invoke endpoint may create a preview capability.
pub(crate) async fn open(
    app: AppHandle,
    target: FileTarget,
) -> std::result::Result<Option<PreviewData>, String> {
    let path = file_actions::resolve_target(&app.state::<GuiState>(), &target)
        .await
        .map_err(|error| error.to_string())?;
    let loaded = tauri::async_runtime::spawn_blocking(move || load_session(&path, &target))
        .await
        .map_err(|_| PreviewError::Open.to_string())?
        .map_err(|error| error.to_string())?;
    let Some((data, scope)) = loaded else {
        return Ok(None);
    };
    app.state::<PreviewSessions>()
        .hosted
        .lock()
        .await
        .insert(data.session_id.clone(), scope);
    Ok(Some(data))
}

fn load_session(path: &Path, target: &FileTarget) -> Result<Option<(PreviewData, server::Scope)>> {
    let Some(mut data) = content::load(path)? else {
        return Ok(None);
    };
    data.session_id = uuid::Uuid::new_v4().to_string();
    let token = format!("{}{}", PATH_PREFIX.trim_start_matches('/'), data.session_id);
    let scope = server::Scope::new(path, token, String::new())?;
    // A fixed base is used only for URL escaping; clients receive a same-origin path.
    let mut url = url::Url::parse("http://localhost/").map_err(|_| PreviewError::Open)?;
    url.set_path(&format!("{PATH_PREFIX}{}/", data.session_id));
    url.path_segments_mut()
        .map_err(|_| PreviewError::Open)?
        .pop_if_empty()
        .push(&data.name);
    data.url = url.path().to_owned();
    data.line = target.line;
    data.column = target.column;
    Ok(Some((data, scope)))
}

pub(crate) async fn close(app: AppHandle, session_id: String) -> std::result::Result<(), String> {
    app.state::<PreviewSessions>()
        .hosted
        .lock()
        .await
        .0
        .remove(&session_id);
    Ok(())
}

/// Called on the listener's request worker, never on the UI or an async runtime worker.
pub(crate) fn respond(app: &AppHandle, request: Request) {
    let scope = app
        .state::<PreviewSessions>()
        .hosted
        .blocking_lock()
        .scope(request.url());
    let response = prepare_response(&request, scope.as_deref());
    // Browsers intentionally cancel media streams on seek, close, and navigation.
    if let Err(error) = request.respond(response) {
        if !matches!(
            error.kind(),
            std::io::ErrorKind::BrokenPipe
                | std::io::ErrorKind::ConnectionReset
                | std::io::ErrorKind::ConnectionAborted
        ) {
            eprintln!("hosted file preview stream ended: {}", error.kind());
        }
    }
}

fn prepare_response(request: &Request, scope: Option<&server::Scope>) -> ResponseBox {
    scope
        .and_then(|scope| server::prepare_asset(request, scope).ok())
        .unwrap_or_else(|| Response::empty(StatusCode(404)).boxed())
}

#[cfg(test)]
#[path = "hosted_tests.rs"]
mod tests;
