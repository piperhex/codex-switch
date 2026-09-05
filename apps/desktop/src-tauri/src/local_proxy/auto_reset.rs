use crate::models::{AutoResetSettings, ManagerStateFile, ResetCreditsSummary, UsageSummary};
use chrono::{DateTime, Utc};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::Runtime;

const RETRY_COOLDOWN: Duration = Duration::from_secs(60);
static RESET_BATCH: OnceLock<ResetCoordinator> = OnceLock::new();

#[derive(Default)]
struct ResetCoordinator {
    last_attempt: Mutex<Option<Instant>>,
}

impl ResetCoordinator {
    fn run(
        &self,
        work: impl FnOnce() -> Result<Vec<String>, String>,
    ) -> Result<Vec<String>, String> {
        let mut last_attempt = self
            .last_attempt
            .lock()
            .map_err(|_| "自动使用重置卡暂不可用".to_string())?;
        if last_attempt.is_some_and(|last| last.elapsed() < RETRY_COOLDOWN) {
            return Ok(Vec::new());
        }
        let result = work();
        *last_attempt = Some(Instant::now());
        result
    }
}

/// Automatic card use requires both reported windows to be exhausted.
/// Missing windows and failed queries never authorize spending a card.
pub(crate) fn quota_is_exhausted(usage: &UsageSummary) -> bool {
    usage.error.is_none()
        && [usage.primary.as_ref(), usage.secondary.as_ref()]
            .into_iter()
            .all(|window| window.is_some_and(|window| window.remaining_percent == 0.0))
}

fn credit_expirations(credits: &ResetCreditsSummary) -> Vec<i64> {
    let now = Utc::now().timestamp();
    credits
        .credits
        .iter()
        .filter_map(|credit| match &credit.expires_at {
            None => Some(i64::MAX),
            Some(value) => DateTime::parse_from_rfc3339(value)
                .ok()
                .map(|date| date.timestamp())
                .filter(|expires| *expires > now),
        })
        .collect()
}

pub(crate) fn available_credit_count(credits: &ResetCreditsSummary) -> usize {
    credit_expirations(credits).len()
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct Pool {
    settings: AutoResetSettings,
    concurrent: bool,
    active_id: Option<String>,
    group: Option<String>,
    /// All eligible accounts gate the trigger, including accounts not allowed to use cards.
    account_ids: Vec<String>,
    redeemable_ids: Vec<String>,
}

trait ResetBackend {
    fn pool(&mut self) -> Result<Option<Pool>, String>;
    fn usage(&mut self, id: &str) -> Result<UsageSummary, String>;
    fn credits(&mut self, id: &str) -> Result<ResetCreditsSummary, String>;
    fn consume(&mut self, id: &str, pool: &Pool) -> Result<bool, String>;
}

fn exhausted_pool(backend: &mut impl ResetBackend, pool: &Pool) -> Result<bool, String> {
    if pool.account_ids.is_empty() {
        return Ok(false);
    }
    for id in &pool.account_ids {
        // Use the strict refresh API: hidden network errors must not look like cached zero quota.
        if !quota_is_exhausted(&backend.usage(id)?) {
            return Ok(false);
        }
    }
    Ok(true)
}

fn ordered_candidates(backend: &mut impl ResetBackend, pool: &Pool) -> Vec<String> {
    let mut candidates = Vec::new();
    for id in &pool.redeemable_ids {
        if !pool.settings.allows(id) {
            continue;
        }
        match backend.credits(id) {
            Ok(credits) => {
                let expires = credit_expirations(&credits);
                if expires.len() > usize::from(pool.settings.reserve_cards) {
                    if let Some(first) = expires.into_iter().min() {
                        candidates.push((first, id.clone()));
                    }
                }
            }
            Err(error) => eprintln!("automatic reset card lookup failed: {error}"),
        }
    }
    // The consume endpoint chooses the card within an account; prioritize accounts
    // by their earliest available expiry instead of inventing an unsupported card ID.
    candidates.sort();
    candidates.into_iter().map(|(_, id)| id).collect()
}

fn restore_pool(backend: &mut impl ResetBackend) -> Result<Vec<String>, String> {
    let Some(pool) = backend.pool()? else {
        return Ok(Vec::new());
    };
    pool.settings.validate()?;
    if !exhausted_pool(backend, &pool)? {
        return Ok(Vec::new());
    }
    let candidates = ordered_candidates(backend, &pool);
    let mut restored = Vec::new();
    for (attempts, id) in candidates.into_iter().enumerate() {
        if attempts >= pool.settings.budget(pool.concurrent)
            || backend.pool()?.as_ref() != Some(&pool)
        {
            break;
        }
        // Natural recovery or a manual reset elsewhere cancels the remaining batch.
        if !unrestored_accounts_exhausted(backend, &pool, &restored)?
            || backend.pool()?.as_ref() != Some(&pool)
        {
            break;
        }
        // Even ambiguous failures count against this batch. Never retry a possibly consumed card.
        if !backend.consume(&id, &pool)? {
            continue;
        }
        let usage = backend.usage(&id)?;
        if usage.error.is_some()
            || !super::reported_quota_windows_have_remaining(&usage)
            || (usage.primary.is_none() && usage.secondary.is_none())
        {
            break;
        }
        restored.push(id);
    }
    Ok(restored)
}

fn unrestored_accounts_exhausted(
    backend: &mut impl ResetBackend,
    pool: &Pool,
    restored: &[String],
) -> Result<bool, String> {
    for id in pool.account_ids.iter().filter(|id| !restored.contains(id)) {
        if !quota_is_exhausted(&backend.usage(id)?) {
            return Ok(false);
        }
    }
    Ok(true)
}

fn pool_is_enabled(state: &ManagerStateFile) -> bool {
    state.auto_reset.enabled
        && state.auto_switch_on_quota_exhaustion
        && state.active_provider_id.is_none()
        && state.active_provider_group.is_none()
}

struct AppBackend<'a, R: Runtime> {
    app: &'a tauri::AppHandle<R>,
}

/// Keep the normal routing path unchanged; query cards only after the pool is empty.
pub(super) fn concurrent_account<R: Runtime>(
    app: &tauri::AppHandle<R>,
    paths: &crate::storage::Paths,
    state: &ManagerStateFile,
    session_id: Option<&str>,
) -> Result<Option<String>, String> {
    match super::concurrent_account_for_session(paths, state, session_id) {
        Ok(account) => return Ok(account),
        Err(error) => {
            if !pool_is_enabled(state)
                || !super::available_concurrent_account_ids(paths, state)?.is_empty()
            {
                return Err(error);
            }
        }
    }
    if let Err(error) = restore(app) {
        eprintln!("automatic concurrent quota reset failed: {error}");
    }
    let latest = super::try_read_state(paths)?;
    if !latest.concurrent_account_routing_enabled
        || latest.active_provider_id.is_some()
        || latest.active_provider_group.is_some()
        || latest.concurrent_account_group != state.concurrent_account_group
    {
        return Err("路由设置已变更，请重试请求".to_string());
    }
    super::concurrent_account_for_session(paths, &latest, session_id)
}

impl<R: Runtime> ResetBackend for AppBackend<'_, R> {
    fn pool(&mut self) -> Result<Option<Pool>, String> {
        let paths = super::resolve_paths(self.app)?;
        let state = super::try_read_state(&paths)?;
        if !pool_is_enabled(&state) {
            return Ok(None);
        }
        let accounts = crate::commands::list_accounts_blocking(self.app.clone())?;
        let accounts: Vec<_> = accounts
            .into_iter()
            .filter(|account| {
                account.auto_switch_enabled
                    && (!state.concurrent_account_routing_enabled
                        || state
                            .concurrent_account_group
                            .as_ref()
                            .is_none_or(|group| *group == account.group))
            })
            .collect();
        if !state.concurrent_account_routing_enabled
            && !accounts
                .iter()
                .any(|account| state.active_account_id.as_deref() == Some(&account.id))
        {
            return Ok(None);
        }
        let mut account_ids: Vec<_> = accounts.iter().map(|account| account.id.clone()).collect();
        let mut redeemable_ids: Vec<_> = accounts
            .into_iter()
            .filter(|account| !account.agent_identity && account.local_proxy_compatible)
            .map(|account| account.id)
            .collect();
        account_ids.sort();
        redeemable_ids.sort();
        Ok(Some(Pool {
            settings: state.auto_reset,
            concurrent: state.concurrent_account_routing_enabled,
            active_id: state.active_account_id,
            group: state.concurrent_account_group,
            account_ids,
            redeemable_ids,
        }))
    }

    fn usage(&mut self, id: &str) -> Result<UsageSummary, String> {
        crate::commands::try_refresh_usage_blocking(self.app, id)
    }

    fn credits(&mut self, id: &str) -> Result<ResetCreditsSummary, String> {
        crate::commands::fetch_reset_credits_blocking(self.app.clone(), id.to_string())
    }

    fn consume(&mut self, id: &str, pool: &Pool) -> Result<bool, String> {
        let app = self.app;
        crate::commands::consume_exhausted_account_credit(
            app,
            id,
            pool.settings.reserve_cards,
            || Ok(self.pool()?.as_ref() == Some(pool)),
        )
    }
}

/// Called only by proxy request workers. The dedicated batch lock never guards UI reads.
pub(super) fn restore<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<Vec<String>, String> {
    let state = super::try_read_state(&super::resolve_paths(app)?)?;
    if !pool_is_enabled(&state) {
        return Ok(Vec::new());
    }
    RESET_BATCH
        .get_or_init(ResetCoordinator::default)
        .run(|| restore_pool(&mut AppBackend { app }))
}

#[cfg(test)]
#[path = "auto_reset_tests.rs"]
mod tests;
