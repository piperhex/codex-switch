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

#[cfg(all(unix, not(target_os = "macos")))]
fn start_unmanaged_chatgpt(_target: Option<&ChatGptLaunchTarget>) -> Result<(), String> {
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

#[cfg(unix)]
fn status_error(action: &str, status: std::process::ExitStatus) -> String {
    match status.code() {
        Some(code) => format!("{action}（退出码：{code}）"),
        None => format!("{action}（进程被信号终止）"),
    }
}
