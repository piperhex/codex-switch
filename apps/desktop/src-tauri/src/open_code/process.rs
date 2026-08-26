use std::{
    path::{Path, PathBuf},
    process::Command,
    thread,
    time::{Duration, Instant},
};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use sysinfo::{ProcessesToUpdate, System};
use tauri::{AppHandle, Runtime};

use super::command_name_matches;
#[cfg(windows)]
use super::known_windows_commands;
use crate::third_party_apps::runtime_paths::LaunchableApp;

const PROCESS_EXIT_TIMEOUT: Duration = Duration::from_secs(10);
const PROCESS_POLL_INTERVAL: Duration = Duration::from_millis(100);
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

fn open_code_process_running(command_path: &Path) -> bool {
    let mut system = System::new_all();
    system.refresh_processes(ProcessesToUpdate::All, true);
    system
        .processes()
        .values()
        .any(|process| is_open_code_process(process, command_path))
}

fn is_open_code_process(process: &sysinfo::Process, command_path: &Path) -> bool {
    if process
        .exe()
        .is_some_and(|executable| paths_refer_to_same_command(executable, command_path))
    {
        return true;
    }
    process.cmd().iter().any(|argument| {
        let argument = argument.to_string_lossy().to_ascii_lowercase();
        argument.contains("opencode") || argument.contains("opencode-ai")
    })
}

fn paths_refer_to_same_command(left: &Path, right: &Path) -> bool {
    let left = std::fs::canonicalize(left).unwrap_or_else(|_| left.to_path_buf());
    let right = std::fs::canonicalize(right).unwrap_or_else(|_| right.to_path_buf());

    #[cfg(windows)]
    return left
        .to_string_lossy()
        .eq_ignore_ascii_case(&right.to_string_lossy());

    #[cfg(not(windows))]
    return left == right;
}

#[cfg(windows)]
fn windows_hidden_command(program: &str) -> Command {
    let mut command = Command::new(program);
    command.creation_flags(CREATE_NO_WINDOW);
    command
}

#[cfg(windows)]
fn parse_windows_commands(output: &[u8]) -> Vec<PathBuf> {
    String::from_utf8_lossy(output)
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(PathBuf::from)
        .collect()
}

#[cfg(windows)]
fn resolve_open_code_command<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let mut candidates = known_windows_commands();
    if let Some(path) =
        crate::third_party_apps::runtime_paths::saved_command(app, LaunchableApp::OpenCode)
    {
        candidates.insert(0, path);
    }
    for command in ["opencode", "opencode2"] {
        if let Ok(output) = windows_hidden_command("where.exe").arg(command).output() {
            candidates.extend(parse_windows_commands(&output.stdout));
        }
    }

    candidates
        .into_iter()
        .find(|path| path.is_file() && command_name_matches(path))
        .ok_or_else(|| "未找到 OpenCode。请先安装 OpenCode，并确保 opencode 命令可用。".to_string())
}

#[cfg(not(windows))]
fn resolve_open_code_command<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    if let Some(path) =
        crate::third_party_apps::runtime_paths::saved_command(app, LaunchableApp::OpenCode)
    {
        return Ok(path);
    }
    for command in ["opencode", "opencode2"] {
        let output = Command::new("which").arg(command).output();
        if let Ok(output) = output {
            if let Some(path) = String::from_utf8(output.stdout)
                .ok()
                .map(|path| PathBuf::from(path.trim()))
                .filter(|path| !path.as_os_str().is_empty())
            {
                return Ok(path);
            }
        }
    }
    Err("未找到 OpenCode。请先安装 OpenCode，并确保 opencode 命令可用。".to_string())
}

fn spawn_open_code(command_path: &Path) -> Result<(), String> {
    #[cfg(windows)]
    {
        let command_line = format!("\"{}\"", command_path.display());
        windows_hidden_command("cmd.exe")
            .args(["/D", "/C", "start", "OpenCode", "cmd.exe", "/D", "/K"])
            .arg(command_line)
            .spawn()
            .map_err(|error| format!("无法启动 OpenCode：{error}"))?;
    }
    #[cfg(not(windows))]
    {
        Command::new(command_path)
            .spawn()
            .map_err(|error| format!("无法启动 OpenCode：{error}"))?;
    }
    Ok(())
}

pub(super) async fn launch_open_code<R: Runtime + 'static>(
    app: AppHandle<R>,
) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let command_path = resolve_open_code_command(&app)?;
        if open_code_process_running(&command_path) {
            return Ok(false);
        }
        spawn_open_code(&command_path)?;
        Ok(true)
    })
    .await
    .map_err(|_| "启动 OpenCode 失败，请重试。".to_string())?
}

pub(super) async fn restart_open_code<R: Runtime + 'static>(
    app: AppHandle<R>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let command_path = resolve_open_code_command(&app)?;
        stop_open_code_processes(&command_path)?;
        wait_for_open_code_processes_to_exit(&command_path)?;
        spawn_open_code(&command_path)
    })
    .await
    .map_err(|_| "重启 OpenCode 失败，请重试。".to_string())?
}

fn stop_open_code_processes(command_path: &Path) -> Result<(), String> {
    let mut system = System::new_all();
    system.refresh_processes(ProcessesToUpdate::All, true);
    let mut kill_failed = false;
    for process in system.processes().values() {
        if is_open_code_process(process, command_path) {
            kill_failed |= !process.kill();
        }
    }
    if kill_failed {
        return Err("无法关闭正在运行的 OpenCode，请手动关闭后重试。".to_string());
    }
    Ok(())
}

fn wait_for_open_code_processes_to_exit(command_path: &Path) -> Result<(), String> {
    let deadline = Instant::now() + PROCESS_EXIT_TIMEOUT;
    while open_code_process_running(command_path) {
        if Instant::now() >= deadline {
            return Err("OpenCode 未能及时关闭，请手动关闭后重试。".to_string());
        }
        thread::sleep(PROCESS_POLL_INTERVAL);
    }
    Ok(())
}
