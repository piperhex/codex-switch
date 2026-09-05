#[cfg(target_os = "windows")]
fn refresh_local_codex_path<R: Runtime>(app: &tauri::AppHandle<R>) {
    let Some(path) = discover_running_chatgpt_or_codex_path() else {
        return;
    };
    let Ok(paths) = resolve_paths(app) else {
        return;
    };
    let mut state = read_state(&paths);
    if state.local_codex_path.as_deref() != Some(path.as_str()) {
        state.local_codex_path = Some(path.clone());
        let _ = write_state(&paths, &state);
    }
    let _ = crate::codex_runtime::record_launch_executable(&path);
}

#[cfg(not(target_os = "windows"))]
fn refresh_local_codex_path<R: Runtime>(_app: &tauri::AppHandle<R>) {}

#[cfg(target_os = "windows")]
fn discover_running_chatgpt_or_codex_path() -> Option<String> {
    crate::windows_client_processes::running_desktop_shells()
        .into_iter()
        .next()
        .and_then(|path| normalize_windows_chatgpt_target(&path.to_string_lossy()))
}

pub(crate) fn refresh_and_get_chatgpt_launch_target<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Option<ChatGptLaunchTarget> {
    refresh_local_codex_path(app);

    #[cfg(target_os = "windows")]
    {
        let saved_target = resolve_paths(app)
            .ok()
            .and_then(|paths| read_state(&paths).local_codex_path)
            .filter(|path| Path::new(path).is_file())
            .map(ChatGptLaunchTarget::Executable);
        saved_target.or_else(official_default_chatgpt_target)
    }

    #[cfg(not(target_os = "windows"))]
    {
        None
    }
}

#[cfg(target_os = "windows")]
fn official_default_chatgpt_target() -> Option<ChatGptLaunchTarget> {
    windows_powershell_line(concat!(
        "(Get-AppxPackage -Name OpenAI.Codex -ErrorAction SilentlyContinue | ",
        "Select-Object -First 1 -ExpandProperty InstallLocation)"
    ))
    .and_then(|path| {
        let target = Path::new(&path).join("app").join("ChatGPT.exe");
        target
            .is_file()
            .then(|| target.as_os_str().to_string_lossy().into_owned())
    })
    .map(ChatGptLaunchTarget::Executable)
    .or_else(|| official_chatgpt_shell_app_id().map(ChatGptLaunchTarget::ShellApp))
}

#[cfg(target_os = "windows")]
fn official_chatgpt_shell_app_id() -> Option<String> {
    // Reading the package manifest avoids depending on the localized Start menu
    // display name. Get-StartApps remains a fallback for older package layouts.
    windows_powershell_line(concat!(
        "$package = Get-AppxPackage -Name OpenAI.Codex -ErrorAction SilentlyContinue | ",
        "Select-Object -First 1; if ($package) { $manifest = Get-AppxPackageManifest ",
        "-Package $package.PackageFullName -ErrorAction SilentlyContinue; $application = ",
        "@($manifest.Package.Applications.Application) | Select-Object -First 1; ",
        "if ($application) { \"$($package.PackageFamilyName)!$($application.Id)\" } }"
    ))
    .or_else(|| {
        windows_powershell_line(concat!(
            "$app = Get-StartApps | Where-Object { $_.AppID -like 'OpenAI.Codex_*!*' } | ",
            "Select-Object -First 1; if ($app) { $app.AppID }"
        ))
    })
}

#[cfg(target_os = "windows")]
pub(crate) fn chatgpt_or_codex_is_running() -> Result<bool, String> {
    Ok(crate::windows_client_processes::desktop_is_running())
}

#[cfg(unix)]
pub(crate) fn chatgpt_or_codex_is_running() -> Result<bool, String> {
    for name in [CHATGPT_COMMAND, LEGACY_CODEX_COMMAND] {
        match Command::new("pgrep").args(["-x", name]).status() {
            Ok(status) if status.success() => return Ok(true),
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
            Err(error) => return Err(format!("检查 ChatGPT/Codex 进程失败：{error}")),
        }
    }
    Ok(false)
}

#[cfg(target_os = "windows")]
pub(crate) fn stop_chatgpt_processes() -> Result<(), String> {
    crate::windows_client_processes::stop_desktop_processes().map_err(|error| error.to_string())
}

#[cfg(target_os = "windows")]
pub(crate) fn wait_for_chatgpt_processes_to_exit(timeout: Duration) -> Result<(), String> {
    crate::windows_client_processes::wait_for_desktop_exit(timeout)
        .map_err(|error| error.to_string())
}

#[cfg(unix)]
pub(crate) fn stop_chatgpt_processes() -> Result<(), String> {
    stop_unix_process(CHATGPT_COMMAND)?;
    stop_unix_process(LEGACY_CODEX_COMMAND)?;
    #[cfg(target_os = "macos")]
    {
        stop_unix_process("ChatGPT")?;
        stop_unix_process("Codex")?;
    }
    Ok(())
}

#[cfg(unix)]
pub(crate) fn wait_for_chatgpt_processes_to_exit(_timeout: Duration) -> Result<(), String> {
    Ok(())
}
