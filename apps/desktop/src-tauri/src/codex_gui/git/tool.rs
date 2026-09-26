//! Remote repository tools share the desktop mutation guard and run entirely off the UI thread.
use super::{directory, repository, GitError, GitState, Result};
use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::State;

#[cfg(test)]
mod action_tests;
mod actions;
mod branches;
mod changes;
mod commit;
mod history;
#[cfg(test)]
mod tests;

#[derive(Deserialize)]
#[serde(
    tag = "operation",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub(crate) enum Request {
    Repository {
        cwd: String,
    },
    Action {
        cwd: String,
        #[serde(flatten)]
        request: actions::ActionRequest,
    },
    Changes {
        cwd: String,
    },
    Diff {
        cwd: String,
        path: String,
        commit: Option<String>,
    },
    History {
        cwd: String,
        skip: usize,
    },
    Commit {
        cwd: String,
        head: Option<String>,
        message: String,
        files: Vec<SelectedFile>,
    },
}

#[derive(Deserialize)]
pub(crate) struct SelectedFile {
    path: String,
    version: String,
}

#[derive(Serialize)]
#[serde(untagged)]
pub(crate) enum Response {
    Repository(branches::Repository),
    Done(()),
    Changes(changes::Changes),
    Diff(history::Diff),
    History(history::History),
    Commit { hash: String },
}

fn execute(request: Request) -> Result<Response> {
    let cwd = match &request {
        Request::Changes { cwd }
        | Request::Repository { cwd }
        | Request::Action { cwd, .. }
        | Request::Diff { cwd, .. }
        | Request::History { cwd, .. }
        | Request::Commit { cwd, .. } => cwd,
    };
    let root = repository(&directory(cwd)?)?;
    match request {
        Request::Repository { .. } => branches::read(&root).map(Response::Repository),
        Request::Action { request, .. } => actions::execute(&root, &request).map(Response::Done),
        Request::Changes { .. } => changes::read(&root).map(Response::Changes),
        Request::Diff { path, commit, .. } => {
            history::diff(&root, &path, commit.as_deref()).map(Response::Diff)
        }
        Request::History { skip, .. } => history::read(&root, skip).map(Response::History),
        Request::Commit {
            head,
            message,
            files,
            ..
        } => commit::create(&root, head.as_deref(), &message, &files)
            .map(|hash| Response::Commit { hash }),
    }
}

pub(super) fn validate_path(path: &str) -> Result<()> {
    if path.is_empty()
        || path.contains(['\0', '\\'])
        || Path::new(path).is_absolute()
        || path.split('/').any(|part| {
            part.is_empty()
                || part == ".."
                || part == "."
                || part.eq_ignore_ascii_case(".git")
                || part.contains(':')
        })
    {
        return Err(GitError::File);
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn codex_gui_git_tool(
    state: State<'_, GitState>,
    request: Request,
) -> std::result::Result<Response, String> {
    let guard = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard.lock().map_err(|_| GitError::Operation)?;
        execute(request)
    })
    .await
    .map_err(|_| GitError::Operation.to_string())?
    .map_err(|error| error.to_string())
}
