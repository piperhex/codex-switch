use std::time::Duration;

const RETRY_BUDGET: Duration = Duration::from_secs(60);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(20);
const INITIAL_RETRY_DELAY: Duration = Duration::from_secs(1);
const RETRY_DELAY_INCREMENT: Duration = Duration::from_secs(2);

/// Supplies blocking operations for one refresh generation after its initial request fails.
pub(super) trait RetryOperations {
    type Payload;

    /// Measures time since the initial failure, including every wait and request.
    fn elapsed(&self) -> Duration;
    fn is_current(&self) -> bool;
    fn wait(&mut self, duration: Duration);
    /// Must return within the supplied timeout so the complete retry budget remains bounded.
    fn fetch(&mut self, timeout: Duration) -> Result<Self::Payload, String>;
}

/// A replaced generation is cancelled even if its in-flight request subsequently succeeds.
#[derive(Debug, PartialEq, Eq)]
pub(super) enum RetryOutcome<T> {
    Succeeded(T),
    Cancelled,
    TimedOut,
}

/// Retries sequentially with odd-numbered delays inside one shared sixty-second deadline.
pub(super) fn retry_with_backoff<O: RetryOperations>(
    operations: &mut O,
) -> RetryOutcome<O::Payload> {
    let mut delay = INITIAL_RETRY_DELAY;
    loop {
        if !operations.is_current() {
            return RetryOutcome::Cancelled;
        }
        let remaining = RETRY_BUDGET.saturating_sub(operations.elapsed());
        if remaining.is_zero() {
            return RetryOutcome::TimedOut;
        }
        operations.wait(delay.min(remaining));
        if !operations.is_current() {
            return RetryOutcome::Cancelled;
        }
        let remaining = RETRY_BUDGET.saturating_sub(operations.elapsed());
        if remaining.is_zero() {
            return RetryOutcome::TimedOut;
        }
        let result = operations.fetch(REQUEST_TIMEOUT.min(remaining));
        if !operations.is_current() {
            return RetryOutcome::Cancelled;
        }
        if operations.elapsed() >= RETRY_BUDGET {
            return RetryOutcome::TimedOut;
        }
        if let Ok(payload) = result {
            return RetryOutcome::Succeeded(payload);
        }
        delay += RETRY_DELAY_INCREMENT;
    }
}

#[cfg(test)]
mod tests {
    use std::collections::VecDeque;

    use super::*;

    #[derive(Debug, PartialEq, Eq)]
    enum Operation {
        Wait(Duration),
        Fetch {
            started_at: Duration,
            timeout: Duration,
        },
    }

    #[derive(Default)]
    struct FakeOperations {
        elapsed: Duration,
        cancel_at: Option<Duration>,
        request_duration: Duration,
        results: VecDeque<Result<&'static str, String>>,
        operations: Vec<Operation>,
    }

    impl RetryOperations for FakeOperations {
        type Payload = &'static str;

        fn elapsed(&self) -> Duration {
            self.elapsed
        }

        fn is_current(&self) -> bool {
            self.cancel_at
                .is_none_or(|deadline| self.elapsed < deadline)
        }

        fn wait(&mut self, duration: Duration) {
            self.operations.push(Operation::Wait(duration));
            self.elapsed += duration;
        }

        fn fetch(&mut self, timeout: Duration) -> Result<Self::Payload, String> {
            self.operations.push(Operation::Fetch {
                started_at: self.elapsed,
                timeout,
            });
            self.elapsed += self.request_duration.min(timeout);
            if self.request_duration >= timeout {
                return Err("request timed out".to_string());
            }
            self.results
                .pop_front()
                .unwrap_or_else(|| Err("catalog unavailable".to_string()))
        }
    }

    fn seconds(value: u64) -> Duration {
        Duration::from_secs(value)
    }

    fn failed_request() -> Result<&'static str, String> {
        Err("catalog unavailable".to_string())
    }

    #[test]
    fn retry_delays_increase_by_two_seconds_and_stop_at_the_budget() {
        let mut operations = FakeOperations::default();

        assert_eq!(retry_with_backoff(&mut operations), RetryOutcome::TimedOut);

        let waits: Vec<_> = operations
            .operations
            .iter()
            .filter_map(|operation| match operation {
                Operation::Wait(duration) => Some(*duration),
                _ => None,
            })
            .collect();
        assert_eq!(waits, [1, 3, 5, 7, 9, 11, 13, 11].map(seconds));
        assert_eq!(operations.elapsed, RETRY_BUDGET);
        assert_eq!(operations.operations.len(), 15);
    }

    #[test]
    fn slow_requests_share_the_deadline_and_never_overlap_with_waits() {
        let mut operations = FakeOperations {
            request_duration: seconds(30),
            ..Default::default()
        };

        assert_eq!(retry_with_backoff(&mut operations), RetryOutcome::TimedOut);
        assert_eq!(
            operations.operations,
            vec![
                Operation::Wait(seconds(1)),
                Operation::Fetch {
                    started_at: seconds(1),
                    timeout: seconds(20)
                },
                Operation::Wait(seconds(3)),
                Operation::Fetch {
                    started_at: seconds(24),
                    timeout: seconds(20)
                },
                Operation::Wait(seconds(5)),
                Operation::Fetch {
                    started_at: seconds(49),
                    timeout: seconds(11)
                },
            ]
        );
        assert_eq!(operations.elapsed, RETRY_BUDGET);
    }

    #[test]
    fn success_stops_retrying_and_returns_the_complete_payload() {
        let mut operations = FakeOperations {
            results: VecDeque::from([failed_request(), failed_request(), Ok("complete catalog")]),
            ..Default::default()
        };

        assert_eq!(
            retry_with_backoff(&mut operations),
            RetryOutcome::Succeeded("complete catalog")
        );
        assert_eq!(operations.elapsed, seconds(9));
        assert_eq!(operations.operations.len(), 6);
    }

    #[test]
    fn an_already_replaced_generation_performs_no_operations() {
        let mut operations = FakeOperations {
            cancel_at: Some(Duration::ZERO),
            ..Default::default()
        };

        assert_eq!(retry_with_backoff(&mut operations), RetryOutcome::Cancelled);
        assert!(operations.operations.is_empty());
    }

    #[test]
    fn replacement_during_the_wait_prevents_the_next_request() {
        let mut operations = FakeOperations {
            cancel_at: Some(seconds(1)),
            ..Default::default()
        };

        assert_eq!(retry_with_backoff(&mut operations), RetryOutcome::Cancelled);
        assert_eq!(operations.operations, vec![Operation::Wait(seconds(1))]);
    }

    #[test]
    fn replacement_during_a_successful_request_discards_the_result() {
        let mut operations = FakeOperations {
            cancel_at: Some(seconds(2)),
            request_duration: seconds(2),
            results: VecDeque::from([Ok("stale catalog")]),
            ..Default::default()
        };

        assert_eq!(retry_with_backoff(&mut operations), RetryOutcome::Cancelled);
        assert_eq!(operations.elapsed, seconds(3));
    }

    #[test]
    fn replacement_at_the_deadline_does_not_report_timeout() {
        let mut operations = FakeOperations {
            cancel_at: Some(RETRY_BUDGET),
            request_duration: REQUEST_TIMEOUT,
            ..Default::default()
        };

        assert_eq!(retry_with_backoff(&mut operations), RetryOutcome::Cancelled);
        assert_eq!(operations.elapsed, RETRY_BUDGET);
    }
}
