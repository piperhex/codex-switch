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

#[cfg(windows)]
use winreg::{enums::HKEY_CLASSES_ROOT, RegKey};

use crate::third_party_apps::runtime_paths::LaunchableApp;

const PROCESS_EXIT_TIMEOUT: Duration = Duration::from_secs(10);
const PROCESS_POLL_INTERVAL: Duration = Duration::from_millis(100);
const CLAUDE_CODE_DEEP_LINK: &str = "claude://code/new";
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

enum ClaudeLaunchTarget {
    Desktop,
    Command(PathBuf),
}

fn claude_process_running(target: &ClaudeLaunchTarget) -> bool {
    let mut system = System::new_all();
    system.refresh_processes(ProcessesToUpdate::All, true);
    system
        .processes()
        .values()
        .any(|process| is_claude_code_process(process, target))
}

fn is_claude_code_process(process: &sysinfo::Process, target: &ClaudeLaunchTarget) -> bool {
    if matches!(target, ClaudeLaunchTarget::Desktop) {
        return process.exe().is_some_and(is_claude_desktop_executable);
    }
    let ClaudeLaunchTarget::Command(command_path) = target else {
        return false;
    };
    if process
        .exe()
        .is_some_and(|executable| paths_refer_to_same_command(executable, command_path))
    {
        return true;
    }
    process.cmd().iter().any(|argument| {
        let argument = argument.to_string_lossy().to_ascii_lowercase();
        argument.contains("@anthropic-ai/claude-code") || argument.contains("claude-code/cli.js")
    })
}

#[cfg(target_os = "macos")]
fn is_claude_desktop_executable(path: &Path) -> bool {
    path.file_stem()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.eq_ignore_ascii_case("claude"))
        && path.components().any(|component| {
            component
                .as_os_str()
                .to_string_lossy()
                .eq_ignore_ascii_case("Claude.app")
        })
}

#[cfg(windows)]
fn is_claude_desktop_executable(path: &Path) -> bool {
    path.file_stem()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.eq_ignore_ascii_case("claude"))
        && is_windows_claude_desktop_path(path)
}

#[cfg(windows)]
fn is_windows_claude_desktop_path(path: &Path) -> bool {
    is_windows_app_execution_alias(path)
        || path.components().any(|component| {
            component
                .as_os_str()
                .to_string_lossy()
                .eq_ignore_ascii_case("AnthropicClaude")
        })
}

#[cfg(all(unix, not(target_os = "macos")))]
fn is_claude_desktop_executable(_path: &Path) -> bool {
    false
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
fn is_windows_app_execution_alias(path: &Path) -> bool {
    path.components().any(|component| {
        component
            .as_os_str()
            .to_string_lossy()
            .eq_ignore_ascii_case("WindowsApps")
    })
}

#[cfg(windows)]
fn known_windows_claude_commands() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(home) = dirs::home_dir() {
        candidates.push(home.join(".local").join("bin").join("claude.exe"));
        // Some Windows native installers use the XDG-style config directory.
        candidates.push(
            home.join(".config")
                .join("devai")
                .join("bin")
                .join("claude.exe"),
        );
    }
    if let Some(data_dir) = dirs::data_dir() {
        candidates.push(data_dir.join("npm").join("claude.cmd"));
    }
    if let Some(local_data_dir) = dirs::data_local_dir() {
        candidates.push(
            local_data_dir
                .join("Microsoft")
                .join("WinGet")
                .join("Links")
                .join("claude.exe"),
        );
    }
    candidates
}

#[cfg(windows)]
fn parse_windows_claude_commands(output: &[u8]) -> Vec<PathBuf> {
    String::from_utf8_lossy(output)
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(PathBuf::from)
        .filter(|path| !is_windows_app_execution_alias(path))
        .collect()
}

#[cfg(windows)]
fn claude_desktop_installed() -> bool {
    RegKey::predef(HKEY_CLASSES_ROOT)
        .open_subkey(r"claude\shell\open\command")
        .is_ok()
}

#[cfg(target_os = "macos")]
fn claude_desktop_installed() -> bool {
    let system_app = Path::new("/Applications/Claude.app");
    if system_app.is_dir() {
        return true;
    }
    dirs::home_dir().is_some_and(|home| home.join("Applications").join("Claude.app").is_dir())
}

#[cfg(windows)]
fn resolve_claude_command<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let mut candidates = known_windows_claude_commands();
    if let Some(path) = remembered_or_running_command(app, LaunchableApp::ClaudeCode) {
        candidates.insert(0, path);
    }
    if let Ok(output) = windows_hidden_command("where.exe").arg("claude").output() {
        candidates.extend(parse_windows_claude_commands(&output.stdout));
    }

    candidates
        .into_iter()
        .find(|path| path.is_file() && !is_windows_app_execution_alias(path))
        .ok_or_else(|| {
            "未找到 Claude Code。请先安装 Claude Desktop 或 Claude Code CLI。".to_string()
        })
}

#[cfg(not(windows))]
fn resolve_claude_command<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    if let Some(path) = remembered_or_running_command(app, LaunchableApp::ClaudeCode) {
        return Ok(path);
    }
    let output = Command::new("which").arg("claude").output();

    match output {
        Ok(output) if output.status.success() => String::from_utf8(output.stdout)
            .ok()
            .map(|path| PathBuf::from(path.trim()))
            .filter(|path| !path.as_os_str().is_empty())
            .ok_or_else(|| {
                "未找到 Claude Code。请先安装 Claude Code，并确保 claude 命令可用。".to_string()
            }),
        _ => Err("未找到 Claude Code。请先安装 Claude Code，并确保 claude 命令可用。".to_string()),
    }
}

fn resolve_claude_target<R: Runtime>(app: &AppHandle<R>) -> Result<ClaudeLaunchTarget, String> {
    #[cfg(any(windows, target_os = "macos"))]
    if claude_desktop_installed() {
        return Ok(ClaudeLaunchTarget::Desktop);
    }
    resolve_claude_command(app).map(ClaudeLaunchTarget::Command)
}

fn remembered_or_running_command<R: Runtime>(
    app: &AppHandle<R>,
    app_id: LaunchableApp,
) -> Option<PathBuf> {
    crate::third_party_apps::runtime_paths::saved_command(app, app_id)
        .or_else(|| crate::third_party_apps::runtime_paths::running_command(app_id))
}

#[cfg(windows)]
fn windows_hidden_command(program: &str) -> Command {
    let mut command = Command::new(program);
    command.creation_flags(CREATE_NO_WINDOW);
    command
}

fn spawn_claude(target: &ClaudeLaunchTarget) -> Result<(), String> {
    if matches!(target, ClaudeLaunchTarget::Desktop) {
        return tauri_plugin_opener::open_url(CLAUDE_CODE_DEEP_LINK, None::<&str>)
            .map_err(|error| format!("无法启动 Claude Code：{error}"));
    }
    let ClaudeLaunchTarget::Command(command_path) = target else {
        return Ok(());
    };
    #[cfg(windows)]
    {
        let command_line = format!("\"{}\"", command_path.display());
        windows_hidden_command("cmd.exe")
            .args(["/D", "/C", "start", "Claude Code", "cmd.exe", "/D", "/K"])
            .arg(command_line)
            .spawn()
            .map_err(|error| format!("无法启动 Claude Code：{error}"))?;
    }
    #[cfg(target_os = "macos")]
    {
        let script = format!(
            "tell application \"Terminal\" to do script quoted form of \"{}\"",
            command_path
                .display()
                .to_string()
                .replace('\\', "\\\\")
                .replace('"', "\\\"")
        );
        let status = Command::new("osascript")
            .args([
                "-e",
                "tell application \"Terminal\" to activate",
                "-e",
                &script,
            ])
            .status()
            .map_err(|error| format!("无法启动 Claude Code：{error}"))?;
        if !status.success() {
            return Err("无法启动 Claude Code，请重试。".to_string());
        }
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new(command_path)
            .spawn()
            .map_err(|error| format!("无法启动 Claude Code：{error}"))?;
    }
    Ok(())
}

pub(super) async fn launch_claude_code<R: Runtime + 'static>(
    app: AppHandle<R>,
) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let target = resolve_claude_target(&app)?;
        let was_running = claude_process_running(&target);
        if was_running && !matches!(target, ClaudeLaunchTarget::Desktop) {
            return Ok(false);
        }
        spawn_claude(&target)?;
        // A Desktop deep link intentionally opens a new Code session even when the app is
        // already running, so a successful dispatch is always a successful launch action.
        Ok(true)
    })
    .await
    .map_err(|_| "启动 Claude Code 失败，请重试。".to_string())?
}

pub(super) async fn restart_claude_code<R: Runtime + 'static>(
    app: AppHandle<R>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let target = resolve_claude_target(&app)?;
        stop_claude_processes(&target)?;
        wait_for_claude_processes_to_exit(&target)?;
        spawn_claude(&target)
    })
    .await
    .map_err(|_| "重启 Claude Code 失败，请重试。".to_string())?
}

fn stop_claude_processes(target: &ClaudeLaunchTarget) -> Result<(), String> {
    let mut system = System::new_all();
    system.refresh_processes(ProcessesToUpdate::All, true);
    let mut kill_failed = false;
    for process in system.processes().values() {
        if is_claude_code_process(process, target) {
            kill_failed |= !process.kill();
        }
    }
    if kill_failed {
        return Err("无法关闭正在运行的 Claude Code，请手动关闭后重试。".to_string());
    }
    Ok(())
}

fn wait_for_claude_processes_to_exit(target: &ClaudeLaunchTarget) -> Result<(), String> {
    let deadline = Instant::now() + PROCESS_EXIT_TIMEOUT;
    while claude_process_running(target) {
        if Instant::now() >= deadline {
            return Err("Claude Code 未能及时关闭，请手动关闭后重试。".to_string());
        }
        thread::sleep(PROCESS_POLL_INTERVAL);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(windows)]
    #[test]
    fn windows_command_discovery_skips_the_claude_desktop_alias() {
        let output = concat!(
            "C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps\\Claude.exe\r\n",
            "C:\\Users\\me\\.local\\bin\\claude.exe\r\n"
        );

        assert_eq!(
            parse_windows_claude_commands(output.as_bytes()),
            vec![PathBuf::from("C:\\Users\\me\\.local\\bin\\claude.exe")]
        );
    }

    #[cfg(windows)]
    #[test]
    fn known_windows_commands_include_the_devai_native_install() {
        let home = dirs::home_dir().expect("Windows tests should have a home directory");
        assert!(known_windows_claude_commands().contains(
            &home
                .join(".config")
                .join("devai")
                .join("bin")
                .join("claude.exe")
        ));
    }

    #[cfg(windows)]
    #[test]
    fn recognizes_both_windows_claude_desktop_installations() {
        assert!(is_claude_desktop_executable(Path::new(
            r"C:\Program Files\WindowsApps\Claude_1.0.0.0_x64__hash\app\Claude.exe",
        )));
        assert!(is_claude_desktop_executable(Path::new(
            r"C:\Users\me\AppData\Local\AnthropicClaude\app-1.0.0\claude.exe",
        )));
        assert!(!is_claude_desktop_executable(Path::new(
            r"C:\Users\me\AppData\Roaming\npm\claude.cmd",
        )));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn recognizes_claude_desktop_without_treating_the_cli_as_desktop() {
        assert!(is_claude_desktop_executable(Path::new(
            "/Applications/Claude.app/Contents/MacOS/Claude"
        )));
        assert!(!is_claude_desktop_executable(Path::new(
            "/Users/me/.local/bin/claude"
        )));
    }
}
