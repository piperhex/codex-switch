#[cfg(target_os = "windows")]
fn windows_path_key(path: &Path) -> String {
    let value = path.to_string_lossy().replace('/', "\\");
    if let Some(value) = value.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{value}");
    }
    value.strip_prefix(r"\\?\").unwrap_or(&value).to_string()
}

fn same_install(left: &CodexInstall, right: &CodexInstall) -> bool {
    path_eq(&left.executable, &right.executable)
}

#[cfg(target_os = "windows")]
fn attach_matching_package_identity(
    mut install: CodexInstall,
    packaged_installs: &[VersionedCodexInstall],
) -> CodexInstall {
    if install.app_user_model_id.is_none() {
        install.app_user_model_id = packaged_installs
            .iter()
            .map(|(_, packaged)| packaged)
            .find(|packaged| same_install(&install, packaged))
            .and_then(|packaged| packaged.app_user_model_id.clone());
    }
    install
}

#[cfg(target_os = "windows")]
fn restore_package_identity(install: CodexInstall) -> CodexInstall {
    if install.app_user_model_id.is_some() {
        return install;
    }
    let Ok(packaged_installs) = find_codex_installs() else {
        return install;
    };
    attach_matching_package_identity(install, &packaged_installs)
}

fn stop_codex(install: &CodexInstall) -> Result<(), String> {
    let expected = install
        .executable
        .canonicalize()
        .unwrap_or_else(|_| install.executable.clone());
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        let mut system = System::new_all();
        system.refresh_processes(ProcessesToUpdate::All, true);
        let mut found = false;
        for process in system.processes().values() {
            let Some(executable) = process.exe() else {
                continue;
            };
            let executable = executable
                .canonicalize()
                .unwrap_or_else(|_| executable.to_path_buf());
            if path_eq(&executable, &expected) {
                found = true;
                let _ = process.kill();
            }
        }
        if !found {
            return Ok(());
        }
        if Instant::now() >= deadline {
            return Err("Codex could not be stopped safely.".to_string());
        }
        thread::sleep(Duration::from_millis(250));
    }
}

#[cfg(target_os = "windows")]
fn find_codex_installs() -> Result<Vec<VersionedCodexInstall>, String> {
    use windows::{
        core::HSTRING,
        Management::Deployment::PackageManager,
        Win32::{
            Foundation::RPC_E_CHANGED_MODE,
            System::WinRT::{RoInitialize, RoUninitialize, RO_INIT_MULTITHREADED},
        },
    };

    struct RuntimeGuard(bool);
    impl Drop for RuntimeGuard {
        fn drop(&mut self) {
            if self.0 {
                unsafe { RoUninitialize() };
            }
        }
    }

    let initialized_here = match unsafe { RoInitialize(RO_INIT_MULTITHREADED) } {
        Ok(()) => true,
        // The worker can already have a COM apartment. PackageManager remains
        // usable, but this call must not balance initialization it did not own.
        Err(error) if error.code() == RPC_E_CHANGED_MODE => false,
        Err(error) => {
            return Err(format!(
                "Failed to initialize the Windows package runtime: {error}"
            ))
        }
    };
    let _runtime = RuntimeGuard(initialized_here);
    let manager = PackageManager::new()
        .map_err(|error| format!("Failed to open the Windows package manager: {error}"))?;
    let packages = manager
        .FindPackagesByUserSecurityId(&HSTRING::new())
        .map_err(|error| format!("Failed to enumerate installed Windows packages: {error}"))?;
    let mut matches = Vec::new();
    for package in packages {
        let id = package
            .Id()
            .map_err(|error| format!("Failed to inspect a package id: {error}"))?;
        if id.Name().map(|name| name.to_string()).unwrap_or_default() != "OpenAI.Codex"
            || package.IsDevelopmentMode().unwrap_or(true)
            || package.SignatureKind().ok()
                != Some(windows::ApplicationModel::PackageSignatureKind::Store)
        {
            continue;
        }
        let executable = PathBuf::from(
            package
                .InstalledLocation()
                .and_then(|folder| folder.Path())
                .map_err(|error| format!("Failed to resolve the Codex package path: {error}"))?
                .to_string(),
        )
        .join("app")
        .join("ChatGPT.exe");
        if !executable.is_file() {
            continue;
        }
        let entries = package
            .GetAppListEntries()
            .map_err(|error| format!("Failed to read Codex application identity: {error}"))?;
        for index in 0..entries
            .Size()
            .map_err(|error| format!("Failed to read Codex application identity: {error}"))?
        {
            let aumid = entries
                .GetAt(index)
                .and_then(|entry| entry.AppUserModelId())
                .map_err(|error| format!("Failed to read Codex application identity: {error}"))?
                .to_string();
            if aumid.starts_with(&format!("{}!", id.FamilyName().unwrap_or_default())) {
                let version = id.Version().unwrap_or_default();
                matches.push((
                    (
                        version.Major,
                        version.Minor,
                        version.Build,
                        version.Revision,
                    ),
                    CodexInstall {
                        executable: executable.clone(),
                        app_user_model_id: Some(aumid),
                    },
                ));
            }
        }
    }
    if matches.is_empty() {
        return Err(
            "The official OpenAI Codex Microsoft Store package is not installed.".to_string(),
        );
    }
    Ok(matches)
}

#[cfg(target_os = "windows")]
fn find_running_codex_install() -> Option<CodexInstall> {
    let mut system = System::new_all();
    system.refresh_processes(ProcessesToUpdate::All, true);
    for process in system.processes().values() {
        let Some(executable) = process.exe() else {
            continue;
        };
        if !executable
            .file_name()
            .is_some_and(|name| name.eq_ignore_ascii_case("ChatGPT.exe"))
        {
            continue;
        }
        let executable = executable
            .canonicalize()
            .unwrap_or_else(|_| executable.to_path_buf());
        let is_codex_shell = executable.parent().is_some_and(|app_dir| {
            app_dir
                .file_name()
                .is_some_and(|name| name.eq_ignore_ascii_case("app"))
                && app_dir.join("resources").join("codex.exe").is_file()
        });
        if is_codex_shell {
            return Some(restore_package_identity(CodexInstall {
                executable,
                app_user_model_id: None,
            }));
        }
    }
    None
}

#[cfg(target_os = "windows")]
fn find_default_codex_install() -> Result<CodexInstall, String> {
    let mut installs = find_codex_installs()?;
    installs.sort_by_key(|(version, _)| *version);
    installs.pop().map(|(_, install)| install).ok_or_else(|| {
        "The official OpenAI Codex Microsoft Store package is not installed.".to_string()
    })
}

#[cfg(target_os = "windows")]
fn find_codex_install() -> Result<CodexInstall, String> {
    if let Some(running) = find_running_codex_install() {
        return Ok(running);
    }
    find_default_codex_install()
}

fn remembered_codex_install() -> Option<CodexInstall> {
    let executable = read_session().codex_executable.map(PathBuf::from)?;
    if !executable.is_file() {
        return None;
    }
    #[cfg(target_os = "windows")]
    return Some(restore_package_identity(CodexInstall {
        executable,
        app_user_model_id: None,
    }));
    #[cfg(target_os = "macos")]
    Some(CodexInstall { executable })
}

fn find_runtime_launch_install() -> Result<CodexInstall, String> {
    remembered_codex_install()
        .map(Ok)
        .unwrap_or_else(find_codex_install)
}

#[cfg(target_os = "windows")]
fn launch_codex(install: &CodexInstall, arguments: &[String]) -> Result<u32, String> {
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

    // A running or remembered Store install only gives us its executable path.
    // Reattach the package identity before launch so Windows 10 does not try to
    // CreateProcess the protected WindowsApps executable and fail with error 5.
    let resolved_install = restore_package_identity(install.clone());
    if let Some(app_user_model_id) = &resolved_install.app_user_model_id {
        struct ComGuard(bool);
        impl Drop for ComGuard {
            fn drop(&mut self) {
                if self.0 {
                    unsafe { CoUninitialize() };
                }
            }
        }

        let initialized_here = match unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) }.ok()
        {
            Ok(()) => true,
            // Tauri workers can already be initialized as MTA. COM remains
            // available in that case and must not be uninitialized by us.
            Err(error) if error.code() == RPC_E_CHANGED_MODE => false,
            Err(error) => {
                return Err(format!(
                    "Failed to initialize Windows app activation: {error}"
                ))
            }
        };
        let _com = ComGuard(initialized_here);
        let manager: IApplicationActivationManager = unsafe {
            CoCreateInstance(&ApplicationActivationManager, None, CLSCTX_LOCAL_SERVER)
        }
        .map_err(|error| format!("Failed to create Windows app activation manager: {error}"))?;
        let command_line = arguments
            .iter()
            .map(|argument| quote_windows_argument(argument))
            .collect::<Vec<_>>()
            .join(" ");
        return unsafe {
            manager.ActivateApplication(
                &HSTRING::from(app_user_model_id),
                &HSTRING::from(command_line),
                AO_NONE,
            )
        }
        .map_err(|error| format!("Failed to launch Codex: {error}"));
    }

    let mut command = Command::new(&install.executable);
    command.args(arguments);
    command.spawn().map(|child| child.id()).map_err(|error| {
        format!(
            "Failed to launch Codex from {}: {error}",
            install.executable.display()
        )
    })
}

#[cfg(target_os = "windows")]
fn quote_windows_argument(argument: &str) -> String {
    if argument.is_empty() || argument.chars().any(char::is_whitespace) {
        format!("\"{argument}\"")
    } else {
        argument.to_string()
    }
}
