//! External client process control must not stop the GUI's managed CLI or title worker.
use sysinfo::{Process, ProcessRefreshKind, ProcessesToUpdate, Signal, System, UpdateKind};

fn snapshot() -> System {
    let mut system = System::new();
    system.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing().with_exe(UpdateKind::OnlyIfNotSet),
    );
    system
}

fn matches_external_client(process: &Process, name: &str) -> bool {
    process.name() == name
        && process
            .exe()
            .is_some_and(|path| !crate::codex_gui::releases::is_gui_executable(path))
}

pub(super) fn is_running(name: &str) -> bool {
    snapshot()
        .processes()
        .values()
        .any(|process| matches_external_client(process, name))
}

pub(super) fn stop(name: &str) -> Result<(), String> {
    let system = snapshot();
    for process in system
        .processes()
        .values()
        .filter(|process| matches_external_client(process, name))
    {
        if process.kill_with(Signal::Term) != Some(true) {
            return Err("外部 Codex 应用未能关闭，请手动关闭后重试。".into());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unknown_client_has_no_processes_to_stop() {
        let name = format!("missing-gui-test-{}", uuid::Uuid::new_v4());
        assert!(!is_running(&name));
        assert!(stop(&name).is_ok());
    }
}
