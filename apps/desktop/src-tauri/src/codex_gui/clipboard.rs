//! Read file references only in response to a desktop paste gesture.
use serde::Serialize;
use std::path::PathBuf;

const MAX_FILES: usize = 32;

#[derive(Debug, thiserror::Error)]
enum ClipboardError {
    #[error("无法读取剪贴板，请重新复制文件后粘贴。")]
    Read,
    #[error("文件已移动或无法访问，请重新选择。")]
    InvalidFile,
    #[error("每条消息最多添加 32 个文件或文件夹。")]
    TooMany,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
enum FileKind {
    File,
    Folder,
}

/// A validated local reference, without reading or copying the file contents.
#[derive(Debug, Serialize)]
pub(crate) struct ClipboardFile {
    kind: FileKind,
    name: String,
    path: String,
}

fn file_reference(path: PathBuf) -> Result<ClipboardFile, ClipboardError> {
    if !path.is_absolute() {
        return Err(ClipboardError::InvalidFile);
    }
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty() && name.len() <= 500 && !name.chars().any(char::is_control))
        .ok_or(ClipboardError::InvalidFile)?
        .to_owned();
    let metadata = path.metadata().map_err(|_| ClipboardError::InvalidFile)?;
    let kind = if metadata.is_file() {
        FileKind::File
    } else if metadata.is_dir() {
        FileKind::Folder
    } else {
        return Err(ClipboardError::InvalidFile);
    };
    Ok(ClipboardFile {
        kind,
        name,
        path: super::platform::execution_path(&path),
    })
}

fn read_files() -> Result<Vec<ClipboardFile>, ClipboardError> {
    let mut clipboard = arboard::Clipboard::new().map_err(|_| ClipboardError::Read)?;
    let paths = match clipboard.get().file_list() {
        Ok(paths) => paths,
        Err(arboard::Error::ContentNotAvailable) => return Ok(Vec::new()),
        Err(_) => return Err(ClipboardError::Read),
    };
    // Release the clipboard before metadata calls, which may involve network drives.
    drop(clipboard);
    if paths.len() > MAX_FILES {
        return Err(ClipboardError::TooMany);
    }
    paths.into_iter().map(file_reference).collect()
}

#[tauri::command]
pub(crate) async fn codex_gui_clipboard_files() -> Result<Vec<ClipboardFile>, String> {
    tauri::async_runtime::spawn_blocking(read_files)
        .await
        .map_err(|_| ClipboardError::Read.to_string())?
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn references_preserve_names_and_distinguish_folders() {
        let root = std::env::temp_dir().join(format!("clipboard-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let path = root.join("说明 文档.txt");
        std::fs::write(&path, "fixture").unwrap();
        let reference = file_reference(path.clone()).unwrap();
        assert_eq!(reference.name, "说明 文档.txt");
        assert!(matches!(reference.kind, FileKind::File));
        assert!(matches!(
            file_reference(root.clone()).unwrap().kind,
            FileKind::Folder
        ));
        std::fs::remove_file(path).unwrap();
        std::fs::remove_dir(root).unwrap();
    }

    #[test]
    fn rejects_relative_missing_and_control_character_paths() {
        assert!(file_reference(PathBuf::from("relative.txt")).is_err());
        assert!(
            file_reference(std::env::temp_dir().join(uuid::Uuid::new_v4().to_string())).is_err()
        );
        assert!(file_reference(std::env::temp_dir().join("bad\nname.txt")).is_err());
    }
}
