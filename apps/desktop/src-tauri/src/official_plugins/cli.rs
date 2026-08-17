use std::{
    path::{Path, PathBuf},
    process::{Command, Output},
};

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

fn command(executable: &Path, codex_home: &Path) -> Command {
    let mut command = Command::new(executable);
    command.env("NO_COLOR", "1").env("CODEX_HOME", codex_home);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

fn execute(executable: &Path, codex_home: &Path, args: &[&str]) -> std::io::Result<Output> {
    command(executable, codex_home).args(args).output()
}

#[cfg(target_os = "windows")]
fn plugin_appserver_path(codex_home: &Path) -> PathBuf {
    codex_home
        .join("plugins")
        .join(".plugin-appserver")
        .join("codex.exe")
}

fn candidates(codex_home: &Path) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    #[cfg(target_os = "windows")]
    {
        let plugin_cli = plugin_appserver_path(codex_home);
        if plugin_cli.is_file() {
            candidates.push(plugin_cli);
        }
    }
    candidates.push(PathBuf::from("codex"));
    candidates
}

fn execute_first_available(
    candidates: &[PathBuf],
    codex_home: &Path,
    args: &[&str],
) -> std::io::Result<Output> {
    let mut last_error = None;
    for executable in candidates {
        match execute(executable, codex_home, args) {
            Ok(output) => return Ok(output),
            Err(error) if is_unavailable(&error) => last_error = Some(error),
            Err(error) => return Err(error),
        }
    }
    Err(last_error.unwrap_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::NotFound, "Codex CLI was not found")
    }))
}

fn is_unavailable(error: &std::io::Error) -> bool {
    matches!(
        error.kind(),
        std::io::ErrorKind::NotFound | std::io::ErrorKind::PermissionDenied
    )
}

fn startup_error(error: &std::io::Error, fallback: &str) -> String {
    match error.kind() {
        std::io::ErrorKind::NotFound => {
            "Open Codex once, restart Codex Switch, and try again.".to_string()
        }
        std::io::ErrorKind::PermissionDenied => {
            "Codex Switch could not access Codex plugins. Restart both apps and try again."
                .to_string()
        }
        _ => fallback.to_string(),
    }
}

pub(super) fn run(
    codex_home: &Path,
    args: &[&str],
    failure_message: &str,
) -> Result<Output, String> {
    let output = execute_first_available(&candidates(codex_home), codex_home, args)
        .map_err(|error| startup_error(&error, failure_message))?;
    output
        .status
        .success()
        .then_some(output)
        .ok_or_else(|| failure_message.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(target_os = "windows")]
    #[test]
    fn resolves_the_plugin_appserver_outside_windows_apps() {
        let codex_home = Path::new(r"C:\Users\example\.codex");

        assert_eq!(
            plugin_appserver_path(codex_home),
            codex_home
                .join("plugins")
                .join(".plugin-appserver")
                .join("codex.exe")
        );
    }

    #[test]
    fn falls_back_to_the_next_executable_candidate() {
        let missing =
            std::env::temp_dir().join(format!("missing-codex-cli-{}", std::process::id()));
        let codex_home = std::env::temp_dir();
        let output = execute_first_available(
            &[missing, std::env::current_exe().unwrap()],
            &codex_home,
            &["--help"],
        )
        .unwrap();

        assert!(output.status.success());
    }
}
