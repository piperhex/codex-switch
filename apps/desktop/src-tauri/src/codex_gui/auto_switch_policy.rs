use std::{
    collections::{HashMap, HashSet},
    time::{Duration, Instant},
};

use crate::models::AccountSummary;

use super::auto_switch_settings::GuiAutoSwitchSettings;

const BINDING_IDLE_TIMEOUT: Duration = Duration::from_secs(30 * 60);
const MAX_BINDINGS: usize = 2_048;

/// Eligible GUI accounts ordered by their independent priority and remaining quota.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Candidate {
    pub(crate) id: String,
    pub(crate) priority: i32,
    pub(crate) remaining: f64,
}

fn candidate(
    account: &AccountSummary,
    settings: &GuiAutoSwitchSettings,
    excluded: &HashSet<String>,
) -> Option<Candidate> {
    let rule = settings.account_rule(&account.id);
    if excluded.contains(&account.id)
        || !account.local_proxy_compatible
        || account.usage.error.is_some()
        || rule.is_some_and(|rule| !rule.enabled)
    {
        return None;
    }
    let remaining = account.usage.primary.as_ref()?.remaining_percent;
    if !remaining.is_finite()
        || remaining <= 0.0
        || remaining < settings.effective_threshold(&account.id)
        || account.usage.secondary.as_ref().is_some_and(|window| {
            !window.remaining_percent.is_finite() || window.remaining_percent <= 0.0
        })
    {
        return None;
    }
    Some(Candidate {
        id: account.id.clone(),
        priority: rule.map_or(0, |rule| rule.priority),
        remaining,
    })
}

pub(crate) fn candidates(
    accounts: &[AccountSummary],
    settings: &GuiAutoSwitchSettings,
    excluded: &HashSet<String>,
) -> Vec<Candidate> {
    let mut candidates = accounts
        .iter()
        .filter_map(|account| candidate(account, settings, excluded))
        .collect::<Vec<_>>();
    candidates.sort_by(|left, right| {
        left.priority
            .cmp(&right.priority)
            .then_with(|| left.remaining.total_cmp(&right.remaining))
            .then_with(|| left.id.cmp(&right.id))
    });
    candidates
}

/// A failed quota refresh alone is insufficient evidence to replace the current account.
pub(crate) fn current_requires_switch(
    current: Option<&AccountSummary>,
    settings: &GuiAutoSwitchSettings,
) -> bool {
    let Some(current) = current else {
        return true;
    };
    if !current.local_proxy_compatible
        || settings
            .account_rule(&current.id)
            .is_some_and(|rule| !rule.enabled)
    {
        return true;
    }
    if current.usage.error.is_some() {
        return false;
    }
    let Some(primary) = current.usage.primary.as_ref() else {
        return false;
    };
    if primary.remaining_percent.is_finite()
        && primary.remaining_percent < settings.effective_threshold(&current.id)
    {
        return true;
    }
    settings.switch_on_quota_exhaustion
        && [Some(primary), current.usage.secondary.as_ref()]
            .into_iter()
            .flatten()
            .any(|window| window.remaining_percent.is_finite() && window.remaining_percent <= 0.0)
}

#[derive(Debug)]
struct SessionBinding {
    account_id: String,
    last_used: Instant,
}

/// Sticky assignments count conversations, with bounded memory and idle expiry.
#[derive(Debug, Default)]
pub(crate) struct GuiAccountScheduler {
    bindings: HashMap<String, SessionBinding>,
}

impl GuiAccountScheduler {
    pub(crate) fn assign(
        &mut self,
        session: Option<&str>,
        candidates: &[Candidate],
        now: Instant,
    ) -> Option<String> {
        self.expire_idle_bindings(now);
        let Some(session) = session.filter(|session| !session.trim().is_empty()) else {
            return candidates.first().map(|candidate| candidate.id.clone());
        };
        if let Some(binding) = self.bindings.get_mut(session).filter(|binding| {
            candidates
                .iter()
                .any(|candidate| candidate.id == binding.account_id)
        }) {
            binding.last_used = now;
            return Some(binding.account_id.clone());
        }
        // Request-local exclusions cannot invalidate another conversation's binding.
        self.bindings.remove(session);
        let account_id = self.least_assigned(candidates)?;
        self.make_room();
        self.bindings.insert(
            session.to_owned(),
            SessionBinding {
                account_id: account_id.clone(),
                last_used: now,
            },
        );
        Some(account_id)
    }

    pub(crate) fn invalidate_account(&mut self, account_id: &str) {
        self.bindings
            .retain(|_, binding| binding.account_id != account_id);
    }

    fn expire_idle_bindings(&mut self, now: Instant) {
        self.bindings.retain(|_, binding| {
            now.saturating_duration_since(binding.last_used) < BINDING_IDLE_TIMEOUT
        });
    }

    fn least_assigned(&self, candidates: &[Candidate]) -> Option<String> {
        let priority = candidates
            .iter()
            .map(|candidate| candidate.priority)
            .min()?;
        let mut counts = HashMap::<&str, usize>::new();
        for binding in self.bindings.values() {
            *counts.entry(binding.account_id.as_str()).or_default() += 1;
        }
        candidates
            .iter()
            .enumerate()
            .filter(|(_, candidate)| candidate.priority == priority)
            .min_by_key(|(index, candidate)| {
                (
                    counts.get(candidate.id.as_str()).copied().unwrap_or(0),
                    *index,
                )
            })
            .map(|(_, candidate)| candidate.id.clone())
    }

    fn make_room(&mut self) {
        if self.bindings.len() < MAX_BINDINGS {
            return;
        }
        let oldest = self
            .bindings
            .iter()
            .min_by(|(left_id, left), (right_id, right)| {
                left.last_used
                    .cmp(&right.last_used)
                    .then_with(|| left_id.cmp(right_id))
            })
            .map(|(session, _)| session.clone());
        if let Some(session) = oldest {
            self.bindings.remove(&session);
        }
    }
}

#[cfg(test)]
#[path = "auto_switch_policy_tests.rs"]
mod tests;
