use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
};
use tauri::{AppHandle, Runtime};

/// Called from the session list's blocking worker; metadata I/O must stay off the UI thread.
pub(super) fn resolve<R: Runtime>(
    app: &AppHandle<R>,
    session_ids: &HashSet<String>,
) -> HashMap<String, String> {
    if session_ids.is_empty() {
        return HashMap::new();
    }
    let configured = crate::codex_home::resolve_all()
        .unwrap_or_default()
        .into_iter()
        .map(|home| home.path);
    let homes = title_homes(configured, crate::codex_home::gui_home(app).ok());
    resolve_from_homes(&homes, session_ids)
}

fn title_homes(
    configured: impl IntoIterator<Item = PathBuf>,
    gui_home: Option<PathBuf>,
) -> Vec<PathBuf> {
    let mut seen = HashSet::new();
    // The GUI uses its private home even when account/Provider synchronization is disabled.
    configured
        .into_iter()
        .chain(gui_home)
        .filter(|home| seen.insert(home.clone()))
        .collect()
}

fn resolve_from_homes(homes: &[PathBuf], session_ids: &HashSet<String>) -> HashMap<String, String> {
    let mut remaining = session_ids.clone();
    let mut titles = HashMap::new();
    for home in homes {
        if remaining.is_empty() {
            break;
        }
        match crate::commands::conversation_titles_by_id(home, &remaining) {
            Ok(found) => {
                remaining.retain(|id| !found.contains_key(id));
                titles.extend(found);
            }
            Err(error) => {
                // One unavailable home must not hide titles from other clients.
                log_proxy_error!("failed to read proxy session titles: {error}");
            }
        }
    }
    titles
}

#[cfg(test)]
#[path = "tests/session_titles.rs"]
mod tests;
