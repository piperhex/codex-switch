use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::sync::watch;

pub(crate) fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// Native enforcement keeps working when a mobile JavaScript runtime is suspended.
pub(crate) async fn expired(mut deadline: watch::Receiver<u64>) {
    loop {
        let remaining = deadline.borrow_and_update().saturating_sub(now_ms());
        if remaining == 0 {
            return;
        }
        tokio::select! {
            _ = tokio::time::sleep(Duration::from_millis(remaining.min(60_000))) => {},
            changed = deadline.changed() => if changed.is_err() { return; },
        }
    }
}
