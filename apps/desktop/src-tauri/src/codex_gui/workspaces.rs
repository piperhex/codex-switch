use super::{
    error::{GuiError, Result},
    platform::{comparable_path, execution_path},
    protocol::{directory, GuiRequest},
};
#[cfg(test)]
#[path = "workspace_tests.rs"]
mod tests;
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager};

const PROJECTLESS_DIRECTORY: &str = "codex-gui-workspaces";

/// Projectless chats receive their own scratch directory, never the app's checkout or credentials directory.
pub(super) fn prepare_root(app: &AppHandle) -> Result<PathBuf> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|_| GuiError::Workspace)?
        .join(PROJECTLESS_DIRECTORY);
    fs::create_dir_all(&root).map_err(|_| GuiError::Workspace)?;
    root.canonicalize().map_err(|_| GuiError::Workspace)
}

pub(super) fn prepare_request(request: &mut GuiRequest, root: &Path) -> Result<()> {
    match request {
        GuiRequest::Skills { cwd } if cwd.as_ref().is_none_or(|value| value.trim().is_empty()) => {
            *cwd = Some(execution_path(root));
        }
        GuiRequest::Start { cwd, .. } => {
            *cwd = Some(resolve_directory(cwd.as_deref(), root, None)?)
        }
        GuiRequest::Resume {
            cwd: Some(cwd),
            thread_id,
            ..
        }
        | GuiRequest::Send {
            cwd: Some(cwd),
            thread_id,
            ..
        } => {
            *cwd = resolve_directory(Some(cwd), root, Some(thread_id))?;
        }
        _ => {}
    }
    super::attachment_uploads::prepare_request(request, root)
}

fn resolve_directory(cwd: Option<&str>, root: &Path, thread_id: Option<&str>) -> Result<String> {
    if let Some(cwd) = cwd.filter(|path| !path.trim().is_empty()) {
        directory(cwd)?;
        return Ok(cwd.to_owned());
    }
    // Reuse a detached thread's scratch directory so files survive subsequent turns.
    let id = match thread_id {
        Some(id) => uuid::Uuid::parse_str(id).map_err(|_| GuiError::InvalidRequest)?,
        None => uuid::Uuid::new_v4(),
    };
    let workspace = root.join(id.to_string());
    fs::create_dir_all(&workspace).map_err(|_| GuiError::Workspace)?;
    let workspace = workspace.canonicalize().map_err(|_| GuiError::Workspace)?;
    if !workspace.starts_with(root) {
        return Err(GuiError::Workspace);
    }
    Ok(execution_path(&workspace))
}

fn hide_project(thread: &mut Value, root: &str) {
    let Some(cwd) = thread.get("cwd").and_then(Value::as_str) else {
        return;
    };
    let cwd = comparable_path(cwd);
    if cwd == root
        || cwd
            .strip_prefix(root)
            .is_some_and(|suffix| suffix.starts_with('/'))
    {
        thread["cwd"] = json!("");
    }
}

/// Keep the internal scratch path out of the project picker, recent folders and conversation grouping.
pub(super) fn hide_project_paths(value: &mut Value, root: &Path) {
    let root = comparable_path(&root.to_string_lossy());
    if let Some(thread) = value.get_mut("thread") {
        hide_project(thread, &root);
    }
    if let Some(threads) = value.get_mut("data").and_then(Value::as_array_mut) {
        for thread in threads {
            hide_project(thread, &root);
        }
    }
}
