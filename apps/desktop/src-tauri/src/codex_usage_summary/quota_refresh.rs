use std::{
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};

use chrono::{DateTime, Utc};

use crate::{
    models::{ManagerStateFile, UsageSummary},
    storage::{load_usage, usage_path, Paths},
};

const CHECK_INTERVAL: Duration = Duration::from_secs(5);
const USAGE_FRESHNESS: Duration = Duration::from_secs(30);
const MAX_CONCURRENT_REFRESHES: usize = 4;
static REFRESH_STATE: Mutex<RefreshState> = Mutex::new(RefreshState::new());

struct RefreshState {
    running: bool,
    last_started: Option<Instant>,
}

impl RefreshState {
    const fn new() -> Self {
        Self {
            running: false,
            last_started: None,
        }
    }

    fn begin(&mut self, now: Instant) -> bool {
        if self.running
            || self
                .last_started
                .is_some_and(|last| now.saturating_duration_since(last) < CHECK_INTERVAL)
        {
            return false;
        }
        self.running = true;
        self.last_started = Some(now);
        true
    }
}

struct RefreshPermit<'a>(&'a Mutex<RefreshState>);

impl<'a> RefreshPermit<'a> {
    fn acquire(state: &'a Mutex<RefreshState>, now: Instant) -> Option<Self> {
        // Summary publication must never wait for an account refresh or its state lock.
        let acquired = state.try_lock().ok()?.begin(now);
        acquired.then(|| Self(state))
    }
}

impl Drop for RefreshPermit<'_> {
    fn drop(&mut self) {
        match self.0.lock() {
            Ok(mut state) => state.running = false,
            Err(error) => eprintln!("Failed to release the Codex quota refresh: {error}"),
        }
    }
}

/// Refreshes stale displayed quotas independently from the dashboard's browser timers.
pub(super) fn schedule(app: &tauri::AppHandle, paths: &Paths, state: &ManagerStateFile) {
    if state.active_provider_id.is_some()
        || state.active_provider_group.is_some()
        || (!state.concurrent_account_routing_enabled && state.active_account_id.is_none())
    {
        return;
    }
    let Some(permit) = RefreshPermit::acquire(&REFRESH_STATE, Instant::now()) else {
        return;
    };
    let app = app.clone();
    let paths = paths.clone();
    let state = state.clone();
    if let Err(error) = thread::Builder::new()
        .name("codex-quota-refresh".to_string())
        .spawn(move || {
            let _permit = permit;
            refresh_selected_accounts(&app, &paths, &state);
        })
    {
        eprintln!("Failed to start the Codex quota refresh: {error}");
    }
}

fn selected_account_ids(paths: &Paths, state: &ManagerStateFile) -> Result<Vec<String>, String> {
    if state.concurrent_account_routing_enabled {
        return crate::local_proxy::enabled_concurrent_account_ids(paths, state);
    }
    Ok(state.active_account_id.iter().cloned().collect())
}

fn refresh_selected_accounts(app: &tauri::AppHandle, paths: &Paths, state: &ManagerStateFile) {
    let account_ids = match selected_account_ids(paths, state) {
        Ok(ids) => ids,
        Err(error) => {
            eprintln!("Failed to select accounts for the Codex quota refresh: {error}");
            return;
        }
    };
    // A slow account must not delay the whole concurrent pool, while a large pool
    // must not create an unbounded number of network requests or worker threads.
    for batch in account_ids.chunks(MAX_CONCURRENT_REFRESHES) {
        thread::scope(|scope| {
            for id in batch {
                if let Err(error) = thread::Builder::new()
                    .name("codex-account-quota-refresh".to_string())
                    .spawn_scoped(scope, move || refresh_account_if_stale(app, paths, id))
                {
                    eprintln!("Failed to start an account quota refresh: {error}");
                }
            }
        });
    }
}

fn refresh_account_if_stale(app: &tauri::AppHandle, paths: &Paths, id: &str) {
    let usage = load_usage(&usage_path(paths, id));
    if !usage_needs_refresh(&usage, Utc::now()) {
        return;
    }
    if let Err(error) = crate::commands::refresh_usage_blocking(app.clone(), id.to_string()) {
        eprintln!("Failed to refresh the displayed Codex account quota: {error}");
    }
}

fn usage_needs_refresh(usage: &UsageSummary, now: DateTime<Utc>) -> bool {
    let Some(fetched_at) = usage
        .fetched_at
        .as_deref()
        .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
    else {
        return true;
    };
    // Failed API attempts also update fetched_at, providing the same retry backoff.
    now.signed_duration_since(fetched_at)
        .to_std()
        .map_or(true, |age| age >= USAGE_FRESHNESS)
}

#[cfg(test)]
#[path = "quota_refresh_tests.rs"]
mod tests;
