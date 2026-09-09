//! Repository operations run on a worker and never force checkout or discard local edits.
use super::platform::execution_path;
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    process::{Command, Output},
    sync::{Arc, Mutex},
};
use tauri::{AppHandle, Manager, State};

#[cfg(test)]
#[path = "git_tests.rs"]
mod tests;

#[derive(Debug, thiserror::Error)]
pub(super) enum GitError {
    #[error("无法读取项目，请确认文件夹仍然存在。")]
    Directory,
    #[error("无法运行 Git，请确认已安装 Git。")]
    Unavailable,
    #[error("这个文件夹不是 Git 仓库。")]
    Repository,
    #[error("分支名称无效，请换一个名称。")]
    Branch,
    #[error("无法切换分支。请检查未提交的修改，或确认分支未被其他工作树使用。")]
    Checkout,
    #[error("未能创建工作树。请确认仓库已有提交，且分支名称未被使用。")]
    Worktree,
    #[error("操作未完成，请稍后重试。")]
    Operation,
}
pub(super) type Result<T> = std::result::Result<T, GitError>;

/// Serializes file mutations initiated by this GUI, including undo.
#[derive(Default)]
pub(crate) struct GitState(pub(super) Arc<Mutex<()>>);

#[derive(Deserialize)]
#[serde(
    tag = "operation",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub(crate) enum GitRequest {
    Status {
        cwd: String,
    },
    Switch {
        cwd: String,
        branch: String,
        create: bool,
    },
    CreateWorktree {
        cwd: String,
        branch: String,
    },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitStatus {
    cwd: String,
    branch: Option<String>,
    branches: Vec<Branch>,
    changed_files: usize,
    is_worktree: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Branch {
    name: String,
    occupied: bool,
}

pub(super) fn command(cwd: &Path) -> Command {
    let mut command = Command::new("git");
    command
        .current_dir(cwd)
        .args(["-c", "core.hooksPath=", "-c", "core.fsmonitor=false"])
        .env("GIT_TERMINAL_PROMPT", "0");
    // A GUI launched by Git (including checks in hooks) must not inherit another checkout's index or paths.
    for variable in [
        "GIT_DIR",
        "GIT_WORK_TREE",
        "GIT_COMMON_DIR",
        "GIT_INDEX_FILE",
        "GIT_PREFIX",
        "GIT_OBJECT_DIRECTORY",
        "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    ] {
        command.env_remove(variable);
    }
    super::platform::hide_git_window(&mut command);
    command
}

pub(super) fn run(cwd: &Path, args: &[&str]) -> Result<Output> {
    command(cwd)
        .args(args)
        .output()
        .map_err(|_| GitError::Unavailable)
}

fn output(cwd: &Path, args: &[&str]) -> Result<String> {
    let result = run(cwd, args)?;
    if !result.status.success() {
        return Err(GitError::Repository);
    }
    String::from_utf8(result.stdout)
        .map(|text| text.trim().to_owned())
        .map_err(|_| GitError::Operation)
}

fn directory(cwd: &str) -> Result<PathBuf> {
    super::protocol::directory(cwd).map_err(|_| GitError::Directory)
}

fn repository(cwd: &Path) -> Result<PathBuf> {
    let root = output(cwd, &["rev-parse", "--show-toplevel"])?;
    directory(&root)
}

fn validate_branch(cwd: &Path, branch: &str) -> Result<()> {
    if branch.is_empty()
        || branch.len() > 200
        || branch.starts_with('-')
        || branch.contains("@{")
        || !run(cwd, &["check-ref-format", "--branch", branch])?
            .status
            .success()
    {
        return Err(GitError::Branch);
    }
    Ok(())
}

fn status(cwd: &Path) -> Result<GitStatus> {
    let root = repository(cwd)?;
    let branch = output(&root, &["symbolic-ref", "--quiet", "--short", "HEAD"]).ok();
    let refs = output(
        &root,
        &[
            "for-each-ref",
            "--format=%(refname:short)%09%(worktreepath)",
            "refs/heads/",
        ],
    )?;
    let branches = refs
        .lines()
        .map(|line| {
            let (name, path) = line.split_once('\t').unwrap_or((line, ""));
            Branch {
                name: name.to_owned(),
                occupied: !path.is_empty() && branch.as_deref() != Some(name),
            }
        })
        .collect();
    let changes = run(
        &root,
        &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    )?;
    if !changes.status.success() {
        return Err(GitError::Repository);
    }
    let git_dir = output(&root, &["rev-parse", "--absolute-git-dir"])?;
    let common = output(
        &root,
        &["rev-parse", "--path-format=absolute", "--git-common-dir"],
    )?;
    Ok(GitStatus {
        cwd: execution_path(cwd),
        branch,
        branches,
        changed_files: count_changes(&changes.stdout),
        is_worktree: git_dir != common,
    })
}

fn count_changes(bytes: &[u8]) -> usize {
    let mut records = bytes
        .split(|byte| *byte == 0)
        .filter(|record| !record.is_empty());
    let mut count = 0;
    while let Some(record) = records.next() {
        count += 1;
        if record
            .iter()
            .take(2)
            .any(|byte| matches!(byte, b'R' | b'C'))
        {
            records.next();
        }
    }
    count
}

fn switch(cwd: &Path, branch: &str, create: bool) -> Result<()> {
    repository(cwd)?;
    validate_branch(cwd, branch)?;
    let args = if create {
        vec!["switch", "-c", branch]
    } else {
        vec!["switch", "--no-guess", branch]
    };
    if !run(cwd, &args)?.status.success() {
        return Err(GitError::Checkout);
    }
    Ok(())
}

fn create_worktree(cwd: &Path, storage: &Path, branch: &str) -> Result<PathBuf> {
    let root = repository(cwd)?;
    validate_branch(&root, branch)?;
    std::fs::create_dir_all(storage).map_err(|_| GitError::Worktree)?;
    let target = storage.join(uuid::Uuid::new_v4().to_string());
    let destination = execution_path(&target);
    if !run(
        &root,
        &["worktree", "add", "-b", branch, "--", &destination, "HEAD"],
    )?
    .status
    .success()
    {
        return Err(GitError::Worktree);
    }
    // Preserve a selected subdirectory, so the new chat starts in the same part of a monorepo.
    let relative = cwd.strip_prefix(&root).map_err(|_| GitError::Directory)?;
    let selected = target.join(relative);
    Ok(if selected.is_dir() { selected } else { target })
}

fn execute(request: GitRequest, storage: &Path) -> Result<GitStatus> {
    match request {
        GitRequest::Status { cwd } => status(&directory(&cwd)?),
        GitRequest::Switch {
            cwd,
            branch,
            create,
        } => {
            let cwd = directory(&cwd)?;
            switch(&cwd, &branch, create)?;
            status(&cwd)
        }
        GitRequest::CreateWorktree { cwd, branch } => {
            let target = create_worktree(&directory(&cwd)?, storage, &branch)?;
            status(&target)
        }
    }
}

#[tauri::command]
pub(crate) async fn codex_gui_git(
    app: AppHandle,
    state: State<'_, GitState>,
    request: GitRequest,
) -> std::result::Result<GitStatus, String> {
    let guard = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard.lock().map_err(|_| GitError::Operation)?;
        let storage = app
            .path()
            .app_data_dir()
            .map_err(|_| GitError::Directory)?
            .join("git-worktrees");
        execute(request, &storage)
    })
    .await
    .map_err(|_| GitError::Operation.to_string())?
    .map_err(|error| error.to_string())
}
