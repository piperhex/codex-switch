use std::path::Path;
#[cfg(windows)]
use std::path::PathBuf;

use tauri::{AppHandle, Runtime};

mod process;

#[tauri::command]
pub(crate) async fn launch_open_code<R: Runtime + 'static>(
    app: AppHandle<R>,
) -> Result<bool, String> {
    process::launch_open_code(app).await
}

#[tauri::command]
pub(crate) async fn restart_open_code<R: Runtime + 'static>(
    app: AppHandle<R>,
) -> Result<(), String> {
    process::restart_open_code(app).await
}

pub(super) fn command_name_matches(path: &Path) -> bool {
    path.file_stem()
        .and_then(|value| value.to_str())
        .is_some_and(|value| {
            value.eq_ignore_ascii_case("opencode") || value.eq_ignore_ascii_case("opencode2")
        })
}

#[cfg(windows)]
pub(super) fn known_windows_commands() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(home) = dirs::home_dir() {
        candidates.push(home.join(".local").join("bin").join("opencode.exe"));
        candidates.push(home.join(".local").join("bin").join("opencode2.exe"));
    }
    if let Some(data_dir) = dirs::data_dir() {
        candidates.push(data_dir.join("npm").join("opencode.cmd"));
        candidates.push(data_dir.join("npm").join("opencode2.cmd"));
    }
    if let Some(local_data_dir) = dirs::data_local_dir() {
        candidates.push(
            local_data_dir
                .join("Microsoft")
                .join("WinGet")
                .join("Links")
                .join("opencode.exe"),
        );
        candidates.push(
            local_data_dir
                .join("Microsoft")
                .join("WinGet")
                .join("Links")
                .join("opencode2.exe"),
        );
    }
    candidates
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_only_the_opencode_command_name() {
        assert!(command_name_matches(Path::new("opencode.exe")));
        assert!(command_name_matches(Path::new("opencode.cmd")));
        assert!(command_name_matches(Path::new("opencode2.exe")));
        assert!(!command_name_matches(Path::new("claude.exe")));
    }
}
