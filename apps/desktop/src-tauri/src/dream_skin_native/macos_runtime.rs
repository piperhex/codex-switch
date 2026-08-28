#[cfg(target_os = "macos")]
fn find_macos_codex_install_in(applications_dir: &Path) -> Option<CodexInstall> {
    [
        applications_dir
            .join("ChatGPT.app")
            .join("Contents")
            .join("MacOS")
            .join("ChatGPT"),
        applications_dir
            .join("Codex.app")
            .join("Contents")
            .join("MacOS")
            .join("Codex"),
    ]
    .into_iter()
    .find(|path| path.is_file())
    .map(|executable| CodexInstall { executable })
}

#[cfg(target_os = "macos")]
fn find_codex_install() -> Result<CodexInstall, String> {
    let mut applications_dirs = vec![PathBuf::from("/Applications")];
    if let Some(home) = dirs::home_dir() {
        applications_dirs.insert(0, home.join("Applications"));
    }
    applications_dirs
        .into_iter()
        .find_map(|directory| find_macos_codex_install_in(&directory))
        .ok_or_else(|| {
            "The official ChatGPT/Codex app is not installed in Applications.".to_string()
        })
}

#[cfg(target_os = "macos")]
fn find_default_codex_install() -> Result<CodexInstall, String> {
    find_codex_install()
}

#[cfg(target_os = "macos")]
fn launch_codex(install: &CodexInstall, arguments: &[String]) -> Result<u32, String> {
    let mut command = Command::new(&install.executable);
    command.args(arguments);
    command
        .spawn()
        .map(|child| child.id())
        .map_err(|error| format!("Failed to launch Codex: {error}"))
}
