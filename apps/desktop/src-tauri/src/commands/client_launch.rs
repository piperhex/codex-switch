#[cfg(unix)]
fn stop_unix_process(name: &str) -> Result<(), String> {
    let status = Command::new("pkill")
        .args(["-x", name])
        .status()
        .map_err(|error| format!("停止 ChatGPT 失败：{error}"))?;
    if status.success() || status.code() == Some(1) {
        Ok(())
    } else {
        Err(status_error("停止 ChatGPT 失败", status))
    }
}

#[cfg(target_os = "windows")]
pub(crate) fn start_chatgpt(target: Option<&ChatGptLaunchTarget>) -> Result<(), String> {
    if is_windows_10() {
        return start_chatgpt_windows_10(target);
    }
    start_chatgpt_windows_default(target)
}

#[cfg(target_os = "windows")]
fn start_chatgpt_windows_default(target: Option<&ChatGptLaunchTarget>) -> Result<(), String> {
    match target {
        Some(ChatGptLaunchTarget::ShellApp(app_id)) => start_windows_shell_app(app_id),
        Some(ChatGptLaunchTarget::Executable(target)) => {
            start_windows_executable(target).or_else(start_official_windows_chatgpt)
        }
        None => Err("未找到本地 ChatGPT/Codex 路径，且官方默认安装路径不可用".to_string()),
    }
}

/// Windows 10 cannot reliably execute the full-trust entry point from the
/// protected WindowsApps directory with CreateProcess. Activate the Store app
/// by its application user model id instead, which lets the shell apply the
/// package identity and the current user's package permissions.
#[cfg(target_os = "windows")]
fn start_chatgpt_windows_10(target: Option<&ChatGptLaunchTarget>) -> Result<(), String> {
    match target {
        Some(ChatGptLaunchTarget::ShellApp(app_id)) => {
            activate_windows_store_app(app_id).or_else(|native_error| {
                start_windows_shell_app(app_id).map_err(|shell_error| {
                    format!(
                        "Windows 10 原生应用激活失败：{native_error}；Shell 回退也失败：{shell_error}"
                    )
                })
            })
        }
        Some(ChatGptLaunchTarget::Executable(target))
            if is_windows_store_package_executable(target) =>
        {
            start_official_windows_10_chatgpt()
        }
        Some(ChatGptLaunchTarget::Executable(target)) => start_windows_executable(target)
            .or_else(|recorded_error| {
                start_official_windows_10_chatgpt().map_err(|official_error| {
                    format!(
                        "启动已记录的 ChatGPT/Codex 路径失败：{recorded_error}；Windows 10 应用包激活也失败：{official_error}"
                    )
                })
            }),
        None => start_official_windows_10_chatgpt(),
    }
}

#[cfg(target_os = "windows")]
fn start_official_windows_10_chatgpt() -> Result<(), String> {
    let app_id = official_chatgpt_shell_app_id()
        .ok_or_else(|| "Windows 10 未找到已安装的 ChatGPT 应用包身份".to_string())?;
    activate_windows_store_app(&app_id).or_else(|native_error| {
        start_windows_shell_app(&app_id).map_err(|shell_error| {
            format!("Windows 10 原生应用激活失败：{native_error}；Shell 回退也失败：{shell_error}")
        })
    })
}

#[cfg(target_os = "windows")]
fn activate_windows_store_app(app_id: &str) -> Result<(), String> {
    use windows::{
        core::HSTRING,
        Win32::{
            Foundation::RPC_E_CHANGED_MODE,
            System::Com::{
                CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_LOCAL_SERVER,
                COINIT_APARTMENTTHREADED,
            },
            UI::Shell::{ApplicationActivationManager, IApplicationActivationManager, AO_NONE},
        },
    };

    struct ComGuard(bool);
    impl Drop for ComGuard {
        fn drop(&mut self) {
            if self.0 {
                unsafe { CoUninitialize() };
            }
        }
    }

    let initialized_here = match unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) }.ok() {
        Ok(()) => true,
        // A Tauri worker may already have initialized COM with another apartment
        // model. COM is available in that case and must not be uninitialized here.
        Err(error) if error.code() == RPC_E_CHANGED_MODE => false,
        Err(error) => return Err(format!("初始化 Windows 10 应用激活环境失败：{error}")),
    };
    let _com = ComGuard(initialized_here);
    let manager: IApplicationActivationManager =
        unsafe { CoCreateInstance(&ApplicationActivationManager, None, CLSCTX_LOCAL_SERVER) }
            .map_err(|error| format!("创建 Windows 10 应用激活器失败：{error}"))?;

    unsafe { manager.ActivateApplication(&HSTRING::from(app_id), &HSTRING::new(), AO_NONE) }
        .map(|_| ())
        .map_err(|error| format!("按应用包身份启动 ChatGPT 失败：{error}"))
}

#[cfg(target_os = "windows")]
fn start_windows_shell_app(app_id: &str) -> Result<(), String> {
    let app_uri = format!("shell:AppsFolder\\{app_id}");
    windows_hidden_command("explorer.exe")
        .arg(app_uri)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("通过 Windows Shell 启动 ChatGPT 失败：{error}"))
}

#[cfg(target_os = "windows")]
fn start_official_windows_chatgpt(recorded_error: String) -> Result<(), String> {
    let official_target = official_default_chatgpt_target().ok_or(recorded_error.clone())?;
    let result = match official_target {
        ChatGptLaunchTarget::ShellApp(app_id) => start_windows_shell_app(&app_id),
        ChatGptLaunchTarget::Executable(path) => start_windows_executable(&path),
    };
    result.map_err(|official_error| {
        format!(
            concat!(
                "Failed to start the recorded ChatGPT/Codex path: {recorded_error}; ",
                "the official installation also failed: {official_error}"
            ),
            recorded_error = recorded_error,
            official_error = official_error
        )
    })
}

#[cfg(target_os = "windows")]
fn is_windows_10() -> bool {
    let version = windows_version::OsVersion::current();
    !windows_version::is_server() && is_windows_10_version(version.major, version.build)
}

#[cfg(target_os = "windows")]
fn is_windows_10_version(major: u32, build: u32) -> bool {
    major == 10 && build < WINDOWS_11_FIRST_BUILD
}

#[cfg(target_os = "windows")]
fn is_windows_store_package_executable(target: &str) -> bool {
    Path::new(target).components().any(|component| {
        component
            .as_os_str()
            .to_string_lossy()
            .eq_ignore_ascii_case("WindowsApps")
    })
}

#[cfg(target_os = "windows")]
fn start_windows_executable(target: &str) -> Result<(), String> {
    let mut command = windows_hidden_command(target);
    if let Some(parent) = Path::new(target)
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
    {
        command.current_dir(parent);
    }
    command
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("启动 ChatGPT 失败：{error}"))
}

#[cfg(target_os = "windows")]
fn windows_hidden_command(program: &str) -> Command {
    let mut command = Command::new(program);
    command.creation_flags(CREATE_NO_WINDOW);
    command
}

#[cfg(target_os = "windows")]
fn windows_powershell_line(script: &str) -> Option<String> {
    let output = windows_hidden_command("powershell")
        .args(["-NoProfile", "-Command", script])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }

    String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(str::to_string)
}

#[cfg(target_os = "windows")]
fn normalize_windows_chatgpt_target(path: &str) -> Option<String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return None;
    }

    let target = Path::new(trimmed);
    if is_chatgpt_exe(target) {
        return Some(trimmed.to_string());
    }

    if is_codex_exe(target) {
        if let Some(resources) = target
            .parent()
            .filter(|parent| is_dir_named(parent, "resources"))
        {
            if let Some(app_dir) = resources.parent() {
                let app_target = app_dir.join("ChatGPT.exe");
                if app_target.exists() {
                    return Some(app_target.as_os_str().to_string_lossy().into_owned());
                }
            }
        }
    }

    Some(trimmed.to_string())
}

#[cfg(target_os = "windows")]
fn is_chatgpt_exe(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.eq_ignore_ascii_case("ChatGPT.exe"))
        .unwrap_or(false)
}

#[cfg(target_os = "windows")]
fn is_codex_exe(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.eq_ignore_ascii_case("codex.exe"))
        .unwrap_or(false)
}

#[cfg(target_os = "windows")]
fn is_dir_named(path: &Path, expected: &str) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.eq_ignore_ascii_case(expected))
        .unwrap_or(false)
}

#[cfg(target_os = "macos")]
pub(crate) fn start_chatgpt(_target: Option<&ChatGptLaunchTarget>) -> Result<(), String> {
    if matches!(Command::new("open").args(["-a", "ChatGPT"]).status(), Ok(status) if status.success())
    {
        return Ok(());
    }
    if matches!(Command::new("open").args(["-a", "Codex"]).status(), Ok(status) if status.success())
    {
        return Ok(());
    }

    let status = Command::new("osascript")
        .args([
            "-e",
            "tell application \"Terminal\" to activate",
            "-e",
            "tell application \"Terminal\" to do script \"chatgpt || codex\"",
        ])
        .status()
        .map_err(|error| format!("启动 ChatGPT 失败：{error}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(status_error("启动 ChatGPT 失败", status))
    }
}

#[cfg(all(unix, not(target_os = "macos")))]
pub(crate) fn start_chatgpt(_target: Option<&ChatGptLaunchTarget>) -> Result<(), String> {
    let terminals: &[(&str, &[&str])] = &[
        (
            "x-terminal-emulator",
            &["-e", "sh", "-lc", "exec chatgpt || exec codex"],
        ),
        (
            "gnome-terminal",
            &["--", "sh", "-lc", "exec chatgpt || exec codex"],
        ),
        (
            "konsole",
            &["-e", "sh", "-lc", "exec chatgpt || exec codex"],
        ),
        (
            "xfce4-terminal",
            &["-e", "sh", "-lc", "exec chatgpt || exec codex"],
        ),
        ("xterm", &["-e", "sh", "-lc", "exec chatgpt || exec codex"]),
    ];

    for (program, args) in terminals {
        match Command::new(program).args(*args).spawn() {
            Ok(_) => return Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("启动 ChatGPT 失败：{error}")),
        }
    }

    Command::new(CHATGPT_COMMAND)
        .spawn()
        .or_else(|_| Command::new(LEGACY_CODEX_COMMAND).spawn())
        .map(|_| ())
        .map_err(|error| format!("启动 ChatGPT 失败：{error}"))
}

fn command_output_error(action: &str, output: &Output) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let detail = if stderr.is_empty() { stdout } else { stderr };
    if detail.is_empty() {
        status_error(action, output.status)
    } else {
        format!("{action}：{detail}")
    }
}

fn status_error(action: &str, status: std::process::ExitStatus) -> String {
    match status.code() {
        Some(code) => format!("{action}（退出码：{code}）"),
        None => format!("{action}（进程被信号终止）"),
    }
}
