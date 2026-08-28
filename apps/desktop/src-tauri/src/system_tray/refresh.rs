use std::sync::atomic::{AtomicU8, Ordering};

use tauri::{AppHandle, Runtime};

use super::{build_menu, TRAY_ID};

const REFRESH_IDLE: u8 = 0;
const REFRESH_RUNNING: u8 = 1;
const REFRESH_PENDING: u8 = 2;

static TRAY_REFRESH_GATE: TrayRefreshGate = TrayRefreshGate::new();

pub(crate) fn refresh_menu<R: Runtime + 'static>(app: &AppHandle<R>) {
    if !TRAY_REFRESH_GATE.request() {
        return;
    }

    let menu_app = app.clone();
    tauri::async_runtime::spawn_blocking(move || loop {
        refresh_menu_once(&menu_app);
        if !TRAY_REFRESH_GATE.finish_iteration() {
            break;
        }
    });
}

fn refresh_menu_once<R: Runtime>(app: &AppHandle<R>) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return;
    };
    match build_menu(app) {
        Ok(menu) => {
            if let Err(error) = tray.set_menu(Some(menu)) {
                eprintln!("failed to refresh tray menu: {error}");
            }
        }
        Err(error) => eprintln!("failed to build tray menu: {error}"),
    }
}

struct TrayRefreshGate {
    state: AtomicU8,
}

impl TrayRefreshGate {
    const fn new() -> Self {
        Self {
            state: AtomicU8::new(REFRESH_IDLE),
        }
    }

    fn request(&self) -> bool {
        loop {
            let current = self.state.load(Ordering::Acquire);
            let (next, should_start_worker) = match current {
                REFRESH_IDLE => (REFRESH_RUNNING, true),
                REFRESH_RUNNING => (REFRESH_PENDING, false),
                REFRESH_PENDING => return false,
                _ => return false,
            };
            if self
                .state
                .compare_exchange_weak(current, next, Ordering::AcqRel, Ordering::Acquire)
                .is_ok()
            {
                return should_start_worker;
            }
        }
    }

    fn finish_iteration(&self) -> bool {
        loop {
            let current = self.state.load(Ordering::Acquire);
            let (next, should_rerun) = match current {
                REFRESH_RUNNING => (REFRESH_IDLE, false),
                REFRESH_PENDING => (REFRESH_RUNNING, true),
                _ => return false,
            };
            if self
                .state
                .compare_exchange_weak(current, next, Ordering::AcqRel, Ordering::Acquire)
                .is_ok()
            {
                return should_rerun;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::TrayRefreshGate;

    #[test]
    fn refresh_requests_are_coalesced_while_a_worker_is_running() {
        let gate = TrayRefreshGate::new();

        assert!(gate.request());
        assert!(!gate.request());
        assert!(!gate.request());
        assert!(gate.finish_iteration());
        assert!(!gate.finish_iteration());
    }

    #[test]
    fn refresh_gate_returns_to_idle_after_the_worker_finishes() {
        let gate = TrayRefreshGate::new();

        assert!(gate.request());
        assert!(!gate.finish_iteration());
        assert!(gate.request());
    }
}
