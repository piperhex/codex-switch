use super::*;
use crate::models::{ResetCredit, UsageWindow};
use std::collections::HashMap;

fn usage(remaining: f64) -> UsageSummary {
    usage_windows(remaining, remaining)
}

fn usage_windows(primary: f64, secondary: f64) -> UsageSummary {
    let window = |remaining| {
        Some(UsageWindow {
            used_percent: 100.0 - remaining,
            remaining_percent: remaining,
            resets_at: None,
            window_minutes: None,
        })
    };
    UsageSummary {
        primary: window(primary),
        secondary: window(secondary),
        ..UsageSummary::default()
    }
}

fn cards(days: &[i64]) -> ResetCreditsSummary {
    ResetCreditsSummary {
        credits: days
            .iter()
            .map(|day| ResetCredit {
                issued_at: None,
                expires_at: Some((Utc::now() + chrono::Duration::days(*day)).to_rfc3339()),
            })
            .collect(),
    }
}

struct FakeBackend {
    pool: Pool,
    usages: HashMap<String, UsageSummary>,
    credits: HashMap<String, ResetCreditsSummary>,
    consumed: Vec<String>,
    refresh_error: bool,
    consume_error: bool,
    recover: bool,
    cancel: bool,
    pool_reads: usize,
    usage_gate: Option<(std::sync::mpsc::Sender<()>, std::sync::mpsc::Receiver<()>)>,
}

impl Default for FakeBackend {
    fn default() -> Self {
        Self {
            pool: Pool {
                settings: AutoResetSettings {
                    enabled: true,
                    ..AutoResetSettings::default()
                },
                concurrent: true,
                active_id: Some("a".into()),
                group: None,
                account_ids: vec!["a".into(), "b".into(), "c".into()],
                redeemable_ids: vec!["a".into(), "b".into(), "c".into()],
            },
            usages: ["a", "b", "c"]
                .into_iter()
                .map(|id| (id.into(), usage(0.0)))
                .collect(),
            credits: [
                ("a".into(), cards(&[30])),
                ("b".into(), cards(&[1])),
                ("c".into(), cards(&[10])),
            ]
            .into_iter()
            .collect(),
            consumed: Vec::new(),
            refresh_error: false,
            consume_error: false,
            recover: true,
            cancel: false,
            pool_reads: 0,
            usage_gate: None,
        }
    }
}

impl ResetBackend for FakeBackend {
    fn pool(&mut self) -> Result<Option<Pool>, String> {
        self.pool_reads += 1;
        if self.cancel && self.pool_reads > 1 {
            return Ok(None);
        }
        Ok(Some(self.pool.clone()))
    }

    fn usage(&mut self, id: &str) -> Result<UsageSummary, String> {
        if let Some((started, release)) = self.usage_gate.take() {
            started.send(()).unwrap();
            release.recv_timeout(Duration::from_secs(5)).unwrap();
        }
        if self.refresh_error {
            return Err("network failure".into());
        }
        Ok(self.usages[id].clone())
    }

    fn credits(&mut self, id: &str) -> Result<ResetCreditsSummary, String> {
        self.credits.remove(id).ok_or_else(|| "no cards".into())
    }

    fn consume(&mut self, id: &str, _pool: &Pool) -> Result<bool, String> {
        self.consumed.push(id.into());
        if self.consume_error {
            return Err("ambiguous response".into());
        }
        if self.recover {
            self.usages.insert(id.into(), usage(100.0));
        }
        Ok(true)
    }
}

#[test]
fn defaults_are_opt_in_and_backward_compatible() {
    let policy: AutoResetSettings = serde_json::from_str("{}").unwrap();
    assert!(!policy.enabled);
    assert_eq!(policy.max_cards, 1);
    assert_eq!(policy.reserve_cards, 0);
    assert_eq!(policy.account_ids, None);
    let state: ManagerStateFile = serde_json::from_str("{}").unwrap();
    assert_eq!(state.auto_reset, policy);
}

#[test]
fn validates_card_limits() {
    for max_cards in [0, 101, u16::MAX] {
        assert!(AutoResetSettings {
            max_cards,
            ..AutoResetSettings::default()
        }
        .validate()
        .is_err());
    }
    assert!(AutoResetSettings {
        reserve_cards: 101,
        ..AutoResetSettings::default()
    }
    .validate()
    .is_err());
}

#[test]
fn unknown_failed_and_positive_usage_never_trigger() {
    assert!(!quota_is_exhausted(&UsageSummary::default()));
    assert!(!quota_is_exhausted(&UsageSummary {
        error: Some("failed".into()),
        ..usage(0.0)
    }));
    assert!(!quota_is_exhausted(&usage(0.1)));
    assert!(quota_is_exhausted(&usage(0.0)));
    for (primary, secondary) in [(0.0, 80.0), (80.0, 0.0), (0.0, 0.1), (0.1, 0.0)] {
        assert!(!quota_is_exhausted(&usage_windows(primary, secondary)));
    }
}

#[test]
fn a_missing_window_never_authorizes_a_reset_card() {
    assert!(!quota_is_exhausted(&UsageSummary {
        primary: None,
        ..usage(0.0)
    }));
    assert!(!quota_is_exhausted(&UsageSummary {
        secondary: None,
        ..usage(0.0)
    }));
}

#[test]
fn either_remaining_window_on_any_backup_blocks_both_routing_modes() {
    for concurrent in [false, true] {
        for (primary, secondary) in [(0.0, 80.0), (80.0, 0.0)] {
            let mut backend = FakeBackend::default();
            backend.pool.concurrent = concurrent;
            backend.pool.settings.max_cards = 3;
            backend.pool.settings.account_ids = Some(vec!["b".into()]);
            backend
                .usages
                .insert("a".into(), usage_windows(primary, secondary));
            assert!(restore_pool(&mut backend).unwrap().is_empty());
            assert!(backend.consumed.is_empty());
        }
    }
}

#[test]
fn prefers_earliest_expiry_and_defaults_to_one_card() {
    let mut backend = FakeBackend::default();
    assert_eq!(restore_pool(&mut backend).unwrap(), ["b"]);
    assert_eq!(backend.consumed, ["b"]);
}

#[test]
fn multiple_cards_restore_distinct_exhausted_accounts_up_to_limit() {
    let mut backend = FakeBackend::default();
    backend.pool.settings.max_cards = 2;
    assert_eq!(restore_pool(&mut backend).unwrap(), ["b", "c"]);
    assert_eq!(backend.consumed, ["b", "c"]);
}

#[test]
fn non_concurrent_mode_always_uses_at_most_one_card() {
    let mut backend = FakeBackend::default();
    backend.pool.settings.max_cards = 3;
    backend.pool.concurrent = false;
    assert_eq!(restore_pool(&mut backend).unwrap(), ["b"]);
}

#[test]
fn an_unselected_account_with_any_quota_blocks_the_whole_batch() {
    let mut backend = FakeBackend::default();
    backend.pool.settings.account_ids = Some(vec!["b".into()]);
    backend.usages.insert("a".into(), usage(0.1));
    assert!(restore_pool(&mut backend).unwrap().is_empty());
    assert!(backend.consumed.is_empty());
}

#[test]
fn empty_pool_or_selection_does_not_consume() {
    let mut backend = FakeBackend::default();
    backend.pool.settings.account_ids = Some(Vec::new());
    assert!(restore_pool(&mut backend).unwrap().is_empty());
    backend.pool.account_ids.clear();
    assert!(restore_pool(&mut backend).unwrap().is_empty());
}

#[test]
fn respects_custom_selection_and_account_reserves() {
    let mut backend = FakeBackend::default();
    backend.pool.settings.account_ids = Some(vec!["a".into(), "b".into()]);
    backend.pool.settings.reserve_cards = 1;
    backend.credits.insert("a".into(), cards(&[10, 20]));
    assert_eq!(restore_pool(&mut backend).unwrap(), ["a"]);
}

#[test]
fn ignores_expired_cards_and_sorts_unknown_expiry_last() {
    let mut backend = FakeBackend::default();
    backend.credits.insert("b".into(), cards(&[-1]));
    backend.credits.insert(
        "a".into(),
        ResetCreditsSummary {
            credits: vec![ResetCredit {
                issued_at: None,
                expires_at: None,
            }],
        },
    );
    assert_eq!(restore_pool(&mut backend).unwrap(), ["c"]);
}

#[test]
fn refresh_failure_prevents_spending_even_when_cached_quota_is_zero() {
    let mut backend = FakeBackend {
        refresh_error: true,
        ..FakeBackend::default()
    };
    assert!(restore_pool(&mut backend).is_err());
    assert!(backend.consumed.is_empty());
}

#[test]
fn setting_changes_cancel_a_prepared_batch() {
    let mut backend = FakeBackend {
        cancel: true,
        ..FakeBackend::default()
    };
    assert!(restore_pool(&mut backend).unwrap().is_empty());
    assert!(backend.consumed.is_empty());
}

#[test]
fn ambiguous_redemption_is_never_retried_with_another_card() {
    let mut backend = FakeBackend {
        consume_error: true,
        ..FakeBackend::default()
    };
    backend.pool.settings.max_cards = 3;
    assert!(restore_pool(&mut backend).is_err());
    assert_eq!(backend.consumed, ["b"]);
}

#[test]
fn stop_if_redemption_does_not_restore_quota() {
    let mut backend = FakeBackend {
        recover: false,
        ..FakeBackend::default()
    };
    backend.pool.settings.max_cards = 3;
    assert!(restore_pool(&mut backend).unwrap().is_empty());
    assert_eq!(backend.consumed, ["b"]);
}

#[test]
fn auto_switch_and_official_routing_are_required() {
    let mut state = ManagerStateFile::default();
    state.auto_reset.enabled = true;
    assert!(!pool_is_enabled(&state));
    state.auto_switch_on_quota_exhaustion = true;
    assert!(pool_is_enabled(&state));
    state.active_provider_id = Some("provider".into());
    assert!(!pool_is_enabled(&state));
}

#[test]
fn simultaneous_requests_run_only_one_reset_batch() {
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Barrier,
    };
    let coordinator = Arc::new(ResetCoordinator::default());
    let requests = Arc::new(Barrier::new(8));
    let calls = Arc::new(AtomicUsize::new(0));
    std::thread::scope(|scope| {
        for _ in 0..8 {
            let (coordinator, requests, calls) =
                (coordinator.clone(), requests.clone(), calls.clone());
            scope.spawn(move || {
                requests.wait();
                coordinator
                    .run(|| {
                        calls.fetch_add(1, Ordering::SeqCst);
                        restore_pool(&mut FakeBackend::default())
                    })
                    .unwrap();
            });
        }
    });
    assert_eq!(calls.load(Ordering::SeqCst), 1);
}

#[test]
fn failed_batches_also_coalesce_until_cooldown_expires() {
    let coordinator = ResetCoordinator::default();
    assert!(coordinator
        .run(|| Err("ambiguous redemption".into()))
        .is_err());
    assert!(coordinator
        .run(|| panic!("must not retry immediately"))
        .unwrap()
        .is_empty());
    *coordinator.last_attempt.lock().unwrap() = Some(Instant::now() - RETRY_COOLDOWN);
    assert_eq!(
        coordinator.run(|| Ok(vec!["restored".into()])).unwrap(),
        ["restored"]
    );
}

#[test]
fn slow_reset_requests_do_not_lock_session_polling_or_routing() {
    let (started, observed) = std::sync::mpsc::channel();
    let (release, resume) = std::sync::mpsc::channel();
    std::thread::scope(|scope| {
        let worker = scope.spawn(move || {
            let mut backend = FakeBackend {
                usage_gate: Some((started, resume)),
                ..FakeBackend::default()
            };
            ResetCoordinator::default()
                .run(|| restore_pool(&mut backend))
                .unwrap()
        });
        observed.recv_timeout(Duration::from_secs(5)).unwrap();
        assert!(super::super::proxy_sessions().try_lock().is_ok());
        assert!(super::super::concurrent_account_router().try_lock().is_ok());
        assert!(super::super::runtime().try_lock().is_ok());
        super::super::concurrent_quota::retain_available(&mut vec!["polling".into()]).unwrap();
        release.send(()).unwrap();
        assert_eq!(worker.join().unwrap(), ["b"]);
    });
}
