use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sysinfo::{ProcessesToUpdate, System};
use tauri::{AppHandle, Manager, Runtime};

use crate::storage::{read_json, write_json_atomic};

const RUNTIME_PATHS_FILE: &str = "third-party-app-paths.json";

#[derive(Debug, Clone, Copy)]
pub(crate) enum LaunchableApp {
    ClaudeCode,
    OpenCode,
}

#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimePaths {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    claude_code: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    open_code: Option<String>,
}

pub(crate) fn saved_command<R: Runtime>(
    app: &AppHandle<R>,
    app_id: LaunchableApp,
) -> Option<PathBuf> {
    let path = runtime_paths_file(app).ok()?;
    let value = read_json(&path).ok()?;
    let paths: RuntimePaths = serde_json::from_value(value).ok()?;
    let saved = match app_id {
        LaunchableApp::ClaudeCode => paths.claude_code,
        LaunchableApp::OpenCode => paths.open_code,
    }?;
    let path = PathBuf::from(saved);
    path.is_file().then_some(path)
}

pub(crate) fn running_command(app_id: LaunchableApp) -> Option<PathBuf> {
    let mut system = System::new_all();
    system.refresh_processes(ProcessesToUpdate::All, true);
    match app_id {
        LaunchableApp::ClaudeCode => find_claude_code_path(&system),
        LaunchableApp::OpenCode => find_open_code_path(&system),
    }
    .map(PathBuf::from)
}

pub(crate) fn capture_running_app_paths<R: Runtime>(app: &AppHandle<R>) {
    let app = app.clone();
    // Process enumeration and JSON persistence are deliberately off the startup thread.
    drop(tauri::async_runtime::spawn_blocking(move || {
        if let Err(error) = capture_running_app_paths_blocking(&app) {
            eprintln!("failed to record running third-party app paths: {error}");
        }
    }));
}

fn capture_running_app_paths_blocking<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let mut system = System::new_all();
    system.refresh_processes(ProcessesToUpdate::All, true);
    let detected = RuntimePaths {
        claude_code: find_claude_code_path(&system),
        open_code: find_open_code_path(&system),
    };
    if detected.claude_code.is_none() && detected.open_code.is_none() {
        return Ok(());
    }

    let path = runtime_paths_file(app)?;
    let mut paths: RuntimePaths = read_json(&path)
        .ok()
        .and_then(|value| serde_json::from_value(value).ok())
        .unwrap_or_default();
    if detected.claude_code.is_some() {
        paths.claude_code = detected.claude_code;
    }
    if detected.open_code.is_some() {
        paths.open_code = detected.open_code;
    }
    let value =
        serde_json::to_value(paths).map_err(|error| format!("序列化三方 App 路径失败：{error}"))?;
    write_json_atomic(&path, &value)
}

fn runtime_paths_file<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法定位三方 App 路径目录：{error}"))?
        .join(RUNTIME_PATHS_FILE))
}

fn find_claude_code_path(system: &System) -> Option<String> {
    system
        .processes()
        .values()
        .filter_map(|process| process.exe())
        .find(|path| is_claude_code_executable(path))
        .map(|path| path.to_string_lossy().into_owned())
}

fn find_open_code_path(system: &System) -> Option<String> {
    system
        .processes()
        .values()
        .filter_map(|process| process.exe())
        .find(|path| is_open_code_executable(path))
        .map(|path| path.to_string_lossy().into_owned())
}

fn is_claude_code_executable(path: &Path) -> bool {
    !is_windows_app_path(path)
        && path
            .file_stem()
            .and_then(|value| value.to_str())
            .is_some_and(|value| value.eq_ignore_ascii_case("claude"))
}

fn is_open_code_executable(path: &Path) -> bool {
    path.file_stem()
        .and_then(|value| value.to_str())
        .is_some_and(|value| {
            value.eq_ignore_ascii_case("opencode") || value.eq_ignore_ascii_case("opencode2")
        })
}

fn is_windows_app_path(path: &Path) -> bool {
    #[cfg(windows)]
    return path.components().any(|component| {
        component
            .as_os_str()
            .to_string_lossy()
            .eq_ignore_ascii_case("WindowsApps")
    });

    #[cfg(not(windows))]
    let _ = path;
    #[cfg(not(windows))]
    return false;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ignores_windows_claude_desktop_paths() {
        assert!(!is_claude_code_executable(Path::new(
            r"C:\Program Files\WindowsApps\Claude_1.0.0.0_x64\Claude.exe",
        )));
        assert!(is_claude_code_executable(Path::new(
            r"C:\Users\me\.config\devai\bin\claude.exe",
        )));
    }

    #[test]
    fn recognizes_open_code_install_paths() {
        assert!(is_open_code_executable(Path::new(
            r"C:\Users\me\AppData\Local\Programs\OpenCode\OpenCode.exe",
        )));
        assert!(!is_open_code_executable(Path::new(r"C:\tools\claude.exe")));
    }
}
