//! Undo uses server-owned edit records and prepares every result before touching the workspace.
use super::{git::GitState, protocol, GuiState};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Component, Path, PathBuf},
};
use tauri::{AppHandle, Manager, State};

#[path = "undo_files.rs"]
mod files;
#[cfg(test)]
#[path = "undo_tests.rs"]
mod tests;

const MAX_EDIT_BYTES: usize = 8 * 1024 * 1024;

#[derive(Debug, thiserror::Error)]
enum UndoError {
    #[error(transparent)]
    Gui(#[from] super::error::GuiError),
    #[error("无法撤销这次修改，请重新打开对话后重试。")]
    Invalid,
    #[error("请等待当前回复结束后再撤销。")]
    Busy,
    #[error("文件已有其他修改，无法完整撤销。请先审核差异。")]
    Conflict,
    #[error("撤销未完成，请确认文件可写后重试。")]
    Io,
    #[error("撤销需要 Git，请确认已安装 Git。")]
    Git,
    #[error("部分文件未能恢复，请检查项目文件后再继续。")]
    Recovery,
}
type Result<T> = std::result::Result<T, UndoError>;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UndoRequest {
    thread_id: String,
    turn_id: String,
    #[serde(default)]
    check_only: bool,
}

#[derive(Serialize)]
pub(crate) struct UndoResponse {
    undone: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChangeKind {
    #[serde(rename = "type")]
    kind: String,
    move_path: Option<String>,
}

#[derive(Deserialize)]
struct Change {
    path: String,
    diff: String,
    kind: ChangeKind,
}

fn changes(thread: &Value, turn_id: &str) -> Result<Vec<Change>> {
    let turns = thread["turns"].as_array().ok_or(UndoError::Invalid)?;
    if thread["status"]["type"] == "active"
        || turns.iter().any(|turn| turn["status"] == "inProgress")
    {
        return Err(UndoError::Busy);
    }
    let turn = turns
        .iter()
        .find(|turn| turn["id"] == turn_id)
        .ok_or(UndoError::Invalid)?;
    let mut changes = Vec::new();
    for item in turn["items"].as_array().ok_or(UndoError::Invalid)? {
        if item["type"] != "fileChange" || item["status"] != "completed" {
            continue;
        }
        let edits: Vec<Change> =
            serde_json::from_value(item["changes"].clone()).map_err(|_| UndoError::Invalid)?;
        changes.extend(edits);
    }
    if changes.is_empty()
        || changes
            .iter()
            .map(|change| change.diff.len())
            .sum::<usize>()
            > MAX_EDIT_BYTES
    {
        return Err(UndoError::Invalid);
    }
    Ok(changes)
}

/// Reject traversal, Git metadata, alternate streams, and symlink/junction ancestors.
fn relative_path(root: &Path, value: &str) -> Result<PathBuf> {
    let path = Path::new(value);
    let display_root = super::platform::execution_path(root);
    let relative = if path.is_absolute() {
        path.strip_prefix(root)
            .or_else(|_| path.strip_prefix(&display_root))
            .map_err(|_| UndoError::Invalid)?
    } else {
        path
    };
    if relative.as_os_str().is_empty() {
        return Err(UndoError::Invalid);
    }
    let mut current = root.to_path_buf();
    for component in relative.components() {
        let Component::Normal(name) = component else {
            return Err(UndoError::Invalid);
        };
        let name_text = name.to_string_lossy();
        if name_text.to_lowercase().trim_end_matches([' ', '.']) == ".git"
            || name_text.contains(':')
        {
            return Err(UndoError::Invalid);
        }
        current.push(name);
        match fs::symlink_metadata(&current) {
            Ok(metadata) if metadata.file_type().is_symlink() => return Err(UndoError::Invalid),
            Ok(_)
                if !current
                    .canonicalize()
                    .map_err(|_| UndoError::Io)?
                    .starts_with(root) =>
            {
                return Err(UndoError::Invalid);
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err(UndoError::Io),
        }
    }
    Ok(relative.to_owned())
}

fn normalized_changes(root: &Path, changes: Vec<Change>) -> Result<Vec<Change>> {
    changes
        .into_iter()
        .map(|mut change| {
            change.path = relative_path(root, &change.path)?
                .to_string_lossy()
                .replace('\\', "/");
            change.kind.move_path = change
                .kind
                .move_path
                .map(|path| {
                    relative_path(root, &path).map(|path| path.to_string_lossy().replace('\\', "/"))
                })
                .transpose()?;
            Ok(change)
        })
        .collect()
}

fn receipt_path(app: &AppHandle, request: &UndoRequest) -> Result<PathBuf> {
    let key = format!("{}\0{}", request.thread_id, request.turn_id);
    let hash = format!("{:x}", Sha256::digest(key.as_bytes()));
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|_| UndoError::Io)?
        .join("edit-undo")
        .join(hash))
}

fn execute(root: &Path, edits: Vec<Change>, receipt: &Path) -> Result<UndoResponse> {
    if receipt.join("completed").is_file() {
        return Ok(UndoResponse { undone: true });
    }
    let edits = normalized_changes(root, edits)?;
    fs::create_dir_all(receipt).map_err(|_| UndoError::Io)?;
    let staging = receipt.join(uuid::Uuid::new_v4().to_string());
    fs::create_dir(&staging).map_err(|_| UndoError::Io)?;
    let result = files::prepare_and_apply(root, &staging, &edits);
    // Preserve a failed recovery's backups; successful and untouched staging directories are disposable.
    if !matches!(result, Err(UndoError::Recovery)) && fs::remove_dir_all(&staging).is_err() {
        eprintln!("Could not clean up an edit undo staging directory");
    }
    result?;
    Ok(UndoResponse { undone: true })
}

async fn read_turn(state: &GuiState, request: &UndoRequest) -> Result<(String, Vec<Change>)> {
    let client = super::connected(state).await?;
    let source = client
        .request(
            "thread/read",
            json!({
                "threadId": request.thread_id, "includeTurns": true,
            }),
        )
        .await?;
    let edits = changes(&source["thread"], &request.turn_id)?;
    let cwd = source["thread"]["cwd"]
        .as_str()
        .ok_or(UndoError::Invalid)?
        .to_owned();
    Ok((cwd, edits))
}

#[tauri::command]
pub(crate) async fn codex_gui_undo(
    app: AppHandle,
    state: State<'_, GuiState>,
    request: UndoRequest,
) -> std::result::Result<UndoResponse, String> {
    protocol::id(&request.thread_id)
        .and_then(|()| protocol::id(&request.turn_id))
        .map_err(|_| UndoError::Invalid.to_string())?;
    let receipt = receipt_path(&app, &request).map_err(|error| error.to_string())?;
    let guard = app.state::<GitState>().0.clone();
    if request.check_only {
        return tauri::async_runtime::spawn_blocking(move || UndoResponse {
            undone: receipt.join("completed").is_file(),
        })
        .await
        .map_err(|_| UndoError::Io.to_string());
    }
    let (cwd, edits) = read_turn(&state, &request)
        .await
        .map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard.lock().map_err(|_| UndoError::Io)?;
        let root = protocol::directory(&cwd).map_err(|_| UndoError::Invalid)?;
        execute(&root, edits, &receipt)
    })
    .await
    .map_err(|_| UndoError::Io.to_string())?
    .map_err(|error| error.to_string())
}
