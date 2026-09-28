//! Recover a stalled host renderer while a remote chat is active. The durable queue fences uncertain sends.
use std::{
    sync::atomic::{AtomicBool, AtomicU64, Ordering},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager, WebviewWindow};

const STALE_SECONDS: u64 = 60;
#[derive(Default)]
struct Health {
    started: std::sync::OnceLock<Instant>,
    active: AtomicBool,
    heartbeat: AtomicU64,
    running: AtomicBool,
}
impl Health {
    fn now(&self) -> u64 {
        self.started.get_or_init(Instant::now).elapsed().as_secs()
    }
    fn stale(&self) -> bool {
        self.active.load(Ordering::Relaxed)
            && self
                .now()
                .saturating_sub(self.heartbeat.load(Ordering::Relaxed))
                >= STALE_SECONDS
    }
}

#[tauri::command]
pub(crate) async fn remote_chat_host_alive(
    app: AppHandle,
    window: WebviewWindow,
    active: bool,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("请在主窗口连接手机聊天。".into());
    }
    app.manage(Health::default());
    let state = app.state::<Health>();
    state.heartbeat.store(state.now(), Ordering::Relaxed);
    state.active.store(active, Ordering::Relaxed);
    if !state.running.swap(true, Ordering::Relaxed) {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            watch(app).await;
        });
    }
    Ok(())
}

async fn watch(app: AppHandle) {
    let mut interval = tokio::time::interval(Duration::from_secs(10));
    loop {
        interval.tick().await;
        let state = app.state::<Health>();
        if !state.stale() {
            continue;
        }
        state.heartbeat.store(state.now(), Ordering::Relaxed);
        let handle = app.clone();
        if app
            .run_on_main_thread(move || {
                if let Some(window) = handle.get_webview_window("main") {
                    if window.reload().is_err() {
                        eprintln!("remote chat renderer recovery failed");
                    }
                }
            })
            .is_err()
        {
            return;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_recovers_an_active_chat_with_a_stale_host() {
        let health = Health::default();
        health
            .started
            .set(Instant::now() - Duration::from_secs(61))
            .unwrap();
        assert!(!health.stale());
        health.active.store(true, Ordering::Relaxed);
        assert!(health.stale());
        health.heartbeat.store(health.now(), Ordering::Relaxed);
        assert!(!health.stale());
    }
}
