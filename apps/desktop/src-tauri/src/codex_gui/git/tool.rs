//! Remote repository tools share the desktop mutation guard and run entirely off the UI thread.
use super::{directory, repository, GitError, GitState, Result};
use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::{AppHandle, Manager, State};

#[cfg(test)]
mod action_tests;
mod actions;
mod branches;
mod changes;
mod commit;
mod commit_files;
#[cfg(test)]
mod commit_files_tests;
mod history;
mod review;
#[cfg(test)]
mod tests;

#[derive(Deserialize)]
#[serde(
    tag = "operation",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub(crate) enum Request {
    Review {
        cwd: String,
        #[serde(flatten)]
        request: review::Action,
    },
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
    CommitFiles {
        cwd: String,
        commit: String,
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
    Review(review::Response),
    Repository(branches::Repository),
    Done(()),
    Changes(changes::Changes),
    Diff(history::Diff),
    History(history::History),
    CommitFiles(Vec<commit_files::CommitFile>),
    Commit { hash: String },
}

fn execute(request: Request) -> Result<Response> {
    let cwd = match &request {
        Request::Review { cwd, .. }
        | Request::Changes { cwd }
        | Request::Repository { cwd }
        | Request::Action { cwd, .. }
        | Request::Diff { cwd, .. }
        | Request::History { cwd, .. }
        | Request::CommitFiles { cwd, .. }
        | Request::Commit { cwd, .. } => cwd,
    };
    let root = repository(&directory(cwd)?)?;
    match request {
        Request::Review { .. } => Err(GitError::Operation),
        Request::Repository { .. } => branches::read(&root).map(Response::Repository),
        Request::Action { request, .. } => actions::execute(&root, &request).map(Response::Done),
        Request::Changes { .. } => changes::read(&root).map(Response::Changes),
        Request::Diff { path, commit, .. } => {
            history::diff(&root, &path, commit.as_deref()).map(Response::Diff)
        }
        Request::History { skip, .. } => history::read(&root, skip).map(Response::History),
        Request::CommitFiles { commit, .. } => {
            commit_files::read(&root, &commit).map(Response::CommitFiles)
        }
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
    app: AppHandle,
    state: State<'_, GitState>,
    request: Request,
) -> std::result::Result<Response, String> {
    let guard = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        // GitHub requests do not mutate local files and must not block unrelated Git tools during network waits.
        let needs_guard = !matches!(
            &request,
            Request::Review {
                request: review::Action::PullRequest | review::Action::CreatePullRequest { .. },
                ..
            }
        );
        let _guard = if needs_guard {
            Some(guard.lock().map_err(|_| GitError::Operation)?)
        } else {
            None
        };
        match request {
            Request::Review { cwd, request } => {
                let data = app
                    .path()
                    .app_data_dir()
                    .map_err(|_| GitError::ReviewStorage)?;
                review::execute(&cwd, &data, request).map(Response::Review)
            }
            request => execute(request),
        }
    })
    .await
    .map_err(|_| GitError::Operation.to_string())?
    .map_err(|error| error.to_string())
}
