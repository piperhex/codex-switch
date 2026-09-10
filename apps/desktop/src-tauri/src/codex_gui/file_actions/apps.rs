use super::{FileError, FileTarget, Result};
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    process::Command,
};

#[cfg(not(windows))]
use super::unix as platform;
#[cfg(windows)]
use super::windows as platform;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(super) enum ApplicationId {
    Default,
    Vscode,
    VisualStudio,
    Explorer,
    Terminal,
    GitBash,
    Wsl,
    AndroidStudio,
    Idea,
    Pycharm,
    Webstorm,
    Phpstorm,
    Other,
}

#[derive(Serialize)]
pub(crate) struct Application {
    id: ApplicationId,
    name: &'static str,
    kind: &'static str,
}

pub(super) const APPLICATIONS: &[(ApplicationId, &str, &str)] = &[
    (ApplicationId::Vscode, "VS Code", "editor"),
    (ApplicationId::VisualStudio, "Visual Studio", "editor"),
    (ApplicationId::Explorer, "文件管理器", "system"),
    (ApplicationId::Terminal, "终端", "terminal"),
    (ApplicationId::GitBash, "Git Bash", "terminal"),
    (ApplicationId::Wsl, "WSL", "terminal"),
    (ApplicationId::AndroidStudio, "Android Studio", "editor"),
    (ApplicationId::Idea, "IntelliJ IDEA", "editor"),
    (ApplicationId::Pycharm, "PyCharm", "editor"),
    (ApplicationId::Webstorm, "WebStorm", "editor"),
    (ApplicationId::Phpstorm, "PhpStorm", "editor"),
    (ApplicationId::Other, "其他应用…", "system"),
];

pub(super) fn available() -> Vec<Application> {
    APPLICATIONS
        .iter()
        .filter(|(id, _, _)| *id == ApplicationId::Explorer || platform::executable(*id).is_some())
        .map(|&(id, name, kind)| Application { id, name, kind })
        .collect()
}

pub(super) fn open(id: ApplicationId, path: &Path, target: &FileTarget) -> Result<()> {
    let text = super::super::platform::execution_path(path);
    match id {
        ApplicationId::Default => {
            tauri_plugin_opener::open_path(text, None::<&str>).map_err(|_| FileError::Open)
        }
        ApplicationId::Explorer => {
            tauri_plugin_opener::reveal_item_in_dir(path).map_err(|_| FileError::Open)
        }
        _ => {
            let executable = platform::executable(id).ok_or(FileError::Application)?;
            let mut command = platform::command(id, &executable, path, target)?;
            command.spawn().map_err(|_| FileError::Open)?;
            Ok(())
        }
    }
}

pub(super) fn editor_arguments(
    command: &mut Command,
    id: ApplicationId,
    path: &Path,
    target: &FileTarget,
) {
    let path = super::super::platform::execution_path(path);
    match (id, target.line) {
        (ApplicationId::Vscode, Some(line)) => {
            command
                .arg("--goto")
                .arg(format!("{path}:{line}:{}", target.column.unwrap_or(1)));
        }
        (
            ApplicationId::Idea
            | ApplicationId::Pycharm
            | ApplicationId::Webstorm
            | ApplicationId::Phpstorm
            | ApplicationId::AndroidStudio,
            Some(line),
        ) => {
            command.arg("--line").arg(line.to_string()).arg(path);
        }
        _ => {
            command.arg(path);
        }
    }
}

pub(super) fn containing_directory(path: &Path) -> Result<PathBuf> {
    if path.is_dir() {
        return Ok(path.to_owned());
    }
    path.parent().map(Path::to_owned).ok_or(FileError::Path)
}
