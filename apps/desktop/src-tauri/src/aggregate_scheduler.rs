use std::{
    collections::{HashMap, HashSet},
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};

const RETRY_DELAYS: [Duration; 3] = [
    Duration::from_secs(1),
    Duration::from_secs(3),
    Duration::from_secs(5),
];

static SCHEDULER: OnceLock<Mutex<AggregateScheduler>> = OnceLock::new();

#[derive(Default)]
struct AggregateScheduler {
    groups: HashMap<String, AggregateRuntime>,
}

#[derive(Default)]
struct AggregateRuntime {
    members: HashMap<String, MemberRuntime>,
    assignments: HashMap<String, String>,
    next_index: usize,
}

#[derive(Default)]
struct MemberRuntime {
    failure_count: usize,
    retry_at: Option<Instant>,
    last_failure_at: Option<Instant>,
    last_success_at: Option<Instant>,
}

#[derive(Clone, Copy)]
struct SelectionContext<'a> {
    session_id: Option<&'a str>,
    member_ids: &'a [String],
    excluded: &'a HashSet<String>,
    now: Instant,
}

struct FailureEvent<'a> {
    aggregate_id: &'a str,
    member_id: &'a str,
    session_id: Option<&'a str>,
    now: Instant,
}

pub(crate) fn select_member(
    aggregate_id: &str,
    session_id: Option<&str>,
    member_ids: &[String],
    excluded: &HashSet<String>,
) -> Result<String, String> {
    with_scheduler(|scheduler| {
        scheduler.select_member_at(
            aggregate_id,
            SelectionContext {
                session_id,
                member_ids,
                excluded,
                now: Instant::now(),
            },
        )
    })
}

pub(crate) fn mark_failure(aggregate_id: &str, member_id: &str, session_id: Option<&str>) {
    let _ = with_scheduler(|scheduler| {
        scheduler.mark_failure_at(FailureEvent {
            aggregate_id,
            member_id,
            session_id,
            now: Instant::now(),
        });
        Ok(())
    });
}

pub(crate) fn mark_success(aggregate_id: &str, member_id: &str) {
    let _ = with_scheduler(|scheduler| {
        scheduler.mark_success_at(aggregate_id, member_id, Instant::now());
        Ok(())
    });
}

pub(crate) fn conversation_counts(
    aggregate_id: &str,
    member_ids: &[String],
    active_session_ids: &HashSet<String>,
) -> Result<HashMap<String, usize>, String> {
    with_scheduler(|scheduler| {
        let counts = scheduler
            .groups
            .get(aggregate_id)
            .map(|runtime| runtime.active_assignment_counts(member_ids, active_session_ids))
            .unwrap_or_else(|| empty_assignment_counts(member_ids));
        Ok(counts)
    })
}

pub(crate) fn reset(aggregate_id: &str) {
    let _ = with_scheduler(|scheduler| {
        scheduler.groups.remove(aggregate_id);
        Ok(())
    });
}

pub(crate) fn clear() {
    let _ = with_scheduler(|scheduler| {
        scheduler.groups.clear();
        Ok(())
    });
}

fn with_scheduler<T>(
    operation: impl FnOnce(&mut AggregateScheduler) -> Result<T, String>,
) -> Result<T, String> {
    let mut scheduler = SCHEDULER
        .get_or_init(|| Mutex::new(AggregateScheduler::default()))
        .lock()
        .map_err(|_| "Aggregate API scheduler lock is poisoned".to_string())?;
    operation(&mut scheduler)
}

impl AggregateScheduler {
    fn select_member_at(
        &mut self,
        aggregate_id: &str,
        context: SelectionContext<'_>,
    ) -> Result<String, String> {
        let runtime = self.groups.entry(aggregate_id.to_string()).or_default();
        runtime.retain_members(context.member_ids);
        if let Some(member_id) = runtime.sticky_member(context) {
            return Ok(member_id);
        }
        let member_id = runtime
            .least_loaded_member(context)
            .ok_or_else(|| "All APIs in this aggregate are temporarily unavailable".to_string())?;
        if let Some(session_id) = context.session_id {
            runtime
                .assignments
                .insert(session_id.to_string(), member_id.clone());
        }
        Ok(member_id)
    }

    fn mark_failure_at(&mut self, event: FailureEvent<'_>) {
        let runtime = self
            .groups
            .entry(event.aggregate_id.to_string())
            .or_default();
        let member = runtime
            .members
            .entry(event.member_id.to_string())
            .or_default();
        member.failure_count = member.failure_count.saturating_add(1);
        let delay_index = member
            .failure_count
            .saturating_sub(1)
            .min(RETRY_DELAYS.len() - 1);
        member.retry_at = Some(event.now + RETRY_DELAYS[delay_index]);
        member.last_failure_at = Some(event.now);
        if let Some(session_id) = event.session_id {
            runtime.assignments.remove(session_id);
        }
    }

    fn mark_success_at(&mut self, aggregate_id: &str, member_id: &str, now: Instant) {
        let runtime = self.groups.entry(aggregate_id.to_string()).or_default();
        let member = runtime.members.entry(member_id.to_string()).or_default();
        member.failure_count = 0;
        member.retry_at = None;
        member.last_failure_at = None;
        member.last_success_at = Some(now);
    }
}

impl AggregateRuntime {
    fn retain_members(&mut self, member_ids: &[String]) {
        self.members
            .retain(|member_id, _| member_ids.iter().any(|candidate| candidate == member_id));
        self.assignments
            .retain(|_, member_id| member_ids.iter().any(|candidate| candidate == member_id));
        for member_id in member_ids {
            self.members.entry(member_id.clone()).or_default();
        }
    }

    fn sticky_member(&self, context: SelectionContext<'_>) -> Option<String> {
        let member_id = self.assignments.get(context.session_id?)?;
        (context.member_ids.contains(member_id)
            && !context.excluded.contains(member_id)
            && self.member_is_healthy(member_id))
        .then(|| member_id.clone())
    }

    fn least_loaded_member(&mut self, context: SelectionContext<'_>) -> Option<String> {
        if let Some(member_id) = self.recovery_probe_member(context) {
            return Some(member_id);
        }
        let healthy = self.candidates(context, true);
        let candidates = if healthy.is_empty() {
            self.candidates(context, false)
        } else {
            healthy
        };
        let counts = self.assignment_counts(context.member_ids);
        let start = self.next_index % context.member_ids.len().max(1);
        let selected = candidates.into_iter().min_by_key(|member_id| {
            let position = context
                .member_ids
                .iter()
                .position(|candidate| candidate == *member_id)
                .unwrap_or(0);
            (
                counts.get(*member_id).copied().unwrap_or(0),
                (position + context.member_ids.len() - start) % context.member_ids.len(),
            )
        })?;
        self.next_index = context
            .member_ids
            .iter()
            .position(|member_id| member_id == selected)
            .unwrap_or(0)
            .saturating_add(1);
        Some(selected.clone())
    }

    fn recovery_probe_member(&mut self, context: SelectionContext<'_>) -> Option<String> {
        let member_id = context.member_ids.iter().find(|member_id| {
            !context.excluded.contains(*member_id)
                && self.members.get(*member_id).is_some_and(|member| {
                    member.failure_count > 0
                        && member
                            .retry_at
                            .is_some_and(|retry_at| retry_at <= context.now)
                })
        })?;
        if let Some(member) = self.members.get_mut(member_id) {
            member.retry_at = Some(context.now + RETRY_DELAYS[RETRY_DELAYS.len() - 1]);
        }
        Some(member_id.clone())
    }

    fn candidates<'a>(&self, context: SelectionContext<'a>, healthy_only: bool) -> Vec<&'a String> {
        context
            .member_ids
            .iter()
            .filter(|member_id| !context.excluded.contains(*member_id))
            .filter(|member_id| self.member_available(member_id, context.now))
            .filter(|member_id| {
                !healthy_only
                    || self
                        .members
                        .get(*member_id)
                        .is_none_or(|member| member.failure_count == 0)
            })
            .collect()
    }

    fn member_available(&self, member_id: &str, now: Instant) -> bool {
        self.members
            .get(member_id)
            .and_then(|member| member.retry_at)
            .is_none_or(|retry_at| retry_at <= now)
    }

    fn member_is_healthy(&self, member_id: &str) -> bool {
        self.members
            .get(member_id)
            .is_none_or(|member| member.failure_count == 0)
    }

    fn assignment_counts(&self, member_ids: &[String]) -> HashMap<String, usize> {
        let mut counts = empty_assignment_counts(member_ids);
        for member_id in self.assignments.values() {
            if let Some(count) = counts.get_mut(member_id) {
                *count = count.saturating_add(1);
            }
        }
        counts
    }

    fn active_assignment_counts(
        &self,
        member_ids: &[String],
        active_session_ids: &HashSet<String>,
    ) -> HashMap<String, usize> {
        let mut counts = empty_assignment_counts(member_ids);
        for (session_id, member_id) in &self.assignments {
            if !active_session_ids.contains(session_id) {
                continue;
            }
            if let Some(count) = counts.get_mut(member_id) {
                *count = count.saturating_add(1);
            }
        }
        counts
    }
}

fn empty_assignment_counts(member_ids: &[String]) -> HashMap<String, usize> {
    member_ids
        .iter()
        .map(|member_id| (member_id.clone(), 0_usize))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn members() -> Vec<String> {
        ["a", "b", "c"].into_iter().map(str::to_string).collect()
    }

    fn selection<'a>(
        session_id: &'a str,
        member_ids: &'a [String],
        excluded: &'a HashSet<String>,
        now: Instant,
    ) -> SelectionContext<'a> {
        SelectionContext {
            session_id: Some(session_id),
            member_ids,
            excluded,
            now,
        }
    }

    fn failure<'a>(member_id: &'a str, now: Instant) -> FailureEvent<'a> {
        FailureEvent {
            aggregate_id: "g",
            member_id,
            session_id: Some("one"),
            now,
        }
    }

    #[test]
    fn balances_new_conversations_and_keeps_them_sticky() {
        let mut scheduler = AggregateScheduler::default();
        let now = Instant::now();
        let excluded = HashSet::new();
        let selected = ["one", "two", "three", "four"]
            .into_iter()
            .map(|session| {
                scheduler
                    .select_member_at("g", selection(session, &members(), &excluded, now))
                    .unwrap()
            })
            .collect::<Vec<_>>();
        assert_eq!(selected, ["a", "b", "c", "a"]);
        assert_eq!(
            scheduler
                .select_member_at("g", selection("two", &members(), &excluded, now))
                .unwrap(),
            "b"
        );
        let active_session_ids = HashSet::from(["one".to_string(), "three".to_string()]);
        assert_eq!(
            scheduler.groups["g"].active_assignment_counts(&members(), &active_session_ids),
            HashMap::from([
                ("a".to_string(), 1),
                ("b".to_string(), 0),
                ("c".to_string(), 1),
            ])
        );
    }

    #[test]
    fn failure_uses_one_three_five_second_cooldowns_and_success_resets() {
        let mut scheduler = AggregateScheduler::default();
        let now = Instant::now();
        for (failure_index, seconds) in [1, 3, 5, 5].into_iter().enumerate() {
            scheduler.mark_failure_at(failure("a", now));
            let retry_at = scheduler.groups["g"].members["a"].retry_at.unwrap();
            assert_eq!(retry_at.duration_since(now), Duration::from_secs(seconds));
            assert_eq!(
                scheduler.groups["g"].members["a"].failure_count,
                failure_index + 1
            );
        }
        scheduler.mark_success_at("g", "a", now);
        scheduler.mark_failure_at(failure("a", now));
        assert_eq!(
            scheduler.groups["g"].members["a"]
                .retry_at
                .unwrap()
                .duration_since(now),
            Duration::from_secs(1)
        );
    }

    #[test]
    fn cooled_down_member_gets_one_recovery_probe() {
        let mut scheduler = AggregateScheduler::default();
        let now = Instant::now();
        let excluded = HashSet::new();
        scheduler.mark_failure_at(failure("a", now));
        let after_cooldown = now + Duration::from_secs(1);
        let selected = scheduler
            .select_member_at("g", selection("two", &members(), &excluded, after_cooldown))
            .unwrap();
        assert_eq!(selected, "a");
        let next = scheduler
            .select_member_at(
                "g",
                selection("three", &members(), &excluded, after_cooldown),
            )
            .unwrap();
        assert_ne!(next, "a");
    }
}
