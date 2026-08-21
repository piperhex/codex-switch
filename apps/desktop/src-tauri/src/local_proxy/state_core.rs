static RUNTIME: OnceLock<Mutex<Option<ProxyRuntime>>> = OnceLock::new();
static TOKEN_USAGE_DB_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
static AUTO_SWITCH_COORDINATOR: OnceLock<AutoSwitchCoordinator> = OnceLock::new();
static PROXY_SESSIONS: OnceLock<Mutex<HashMap<String, ProxySessionState>>> = OnceLock::new();
static CONCURRENT_ACCOUNT_ROUTER: OnceLock<Mutex<ConcurrentAccountRouter>> = OnceLock::new();

#[derive(Default)]
struct ConcurrentAccountRouter {
    assignments: HashMap<String, String>,
}

impl ConcurrentAccountRouter {
    fn account_for_session(
        &mut self,
        session_id: &str,
        enabled_account_ids: &[String],
    ) -> Option<String> {
        if let Some(account_id) = self.assignments.get(session_id) {
            if enabled_account_ids
                .iter()
                .any(|candidate| candidate == account_id)
            {
                return Some(account_id.clone());
            }
        }
        if enabled_account_ids.is_empty() {
            self.assignments.remove(session_id);
            return None;
        }
        self.assignments.remove(session_id);
        let mut conversation_counts = enabled_account_ids
            .iter()
            .map(|account_id| (account_id.as_str(), 0_usize))
            .collect::<HashMap<_, _>>();
        for account_id in self.assignments.values() {
            if let Some(count) = conversation_counts.get_mut(account_id.as_str()) {
                *count = count.saturating_add(1);
            }
        }
        let account_id = enabled_account_ids
            .iter()
            .min_by_key(|account_id| {
                conversation_counts
                    .get(account_id.as_str())
                    .copied()
                    .unwrap_or(0)
            })?
            .clone();
        self.assignments
            .insert(session_id.to_string(), account_id.clone());
        Some(account_id)
    }

    fn clear(&mut self) {
        self.assignments.clear();
    }
}

#[derive(Default)]
struct AutoSwitchCoordinator {
    state: Mutex<AutoSwitchState>,
}

#[derive(Default)]
struct AutoSwitchState {
    // The account generation advances only after a real automatic switch. The attempt
    // generation also advances after no-op/error outcomes so requests that were already
    // in flight do not repeat the same expensive refresh after waiting for the lock.
    active_account_generation: u64,
    switch_attempt_generation: u64,
    last_attempt: Option<CompletedAutoSwitchAttempt>,
}

struct CompletedAutoSwitchAttempt {
    observed_generation: u64,
    failed_account_id: String,
    should_retry: bool,
}

enum AutoSwitchAttempt {
    Unchanged,
    AlreadyChanged,
    Switched,
}

impl AutoSwitchCoordinator {
    fn recover_state<'a>(
        &'a self,
        mut state: MutexGuard<'a, AutoSwitchState>,
    ) -> MutexGuard<'a, AutoSwitchState> {
        // A panic can happen after the account state was written but before the
        // coordinator published it. Advance both generations conservatively so old
        // responses only retry, then keep ordinary official proxying available.
        state.active_account_generation = state.active_account_generation.wrapping_add(1);
        state.switch_attempt_generation = state.switch_attempt_generation.wrapping_add(1);
        state.last_attempt = None;
        self.state.clear_poison();
        state
    }

    fn lock_state(&self) -> MutexGuard<'_, AutoSwitchState> {
        match self.state.lock() {
            Ok(state) => state,
            Err(error) => self.recover_state(error.into_inner()),
        }
    }

    #[cfg(test)]
    fn active_account_generation(&self) -> u64 {
        self.lock_state().active_account_generation
    }

    fn account_snapshot<T, F>(&self, snapshot: F) -> Result<(u64, u64, T), String>
    where
        F: FnOnce() -> Result<T, String>,
    {
        let state = self.lock_state();
        let value = snapshot()?;
        Ok((
            state.active_account_generation,
            state.switch_attempt_generation,
            value,
        ))
    }

    fn switch_or_wait<F>(
        &self,
        observed_generation: u64,
        observed_attempt_generation: u64,
        failed_account_id: &str,
        switch: F,
    ) -> Result<bool, String>
    where
        F: FnOnce() -> Result<AutoSwitchAttempt, String>,
    {
        self.switch_or_wait_with_waiter_hook(
            observed_generation,
            observed_attempt_generation,
            failed_account_id,
            switch,
            || {},
        )
    }

    fn switch_or_wait_with_waiter_hook<F, W>(
        &self,
        observed_generation: u64,
        observed_attempt_generation: u64,
        failed_account_id: &str,
        switch: F,
        waiter_hook: W,
    ) -> Result<bool, String>
    where
        F: FnOnce() -> Result<AutoSwitchAttempt, String>,
        W: FnOnce(),
    {
        let mut state = match self.state.try_lock() {
            Ok(guard) => guard,
            Err(TryLockError::WouldBlock) => {
                waiter_hook();
                self.lock_state()
            }
            Err(TryLockError::Poisoned(error)) => self.recover_state(error.into_inner()),
        };

        if state.active_account_generation != observed_generation {
            return Ok(true);
        }

        if state.switch_attempt_generation != observed_attempt_generation {
            if let Some(last_attempt) = state.last_attempt.as_ref() {
                if last_attempt.observed_generation == observed_generation
                    && last_attempt.failed_account_id == failed_account_id
                {
                    return Ok(last_attempt.should_retry);
                }
            }
        }

        let attempt = match switch() {
            Ok(attempt) => attempt,
            Err(error) => {
                state.switch_attempt_generation = state.switch_attempt_generation.wrapping_add(1);
                state.last_attempt = Some(CompletedAutoSwitchAttempt {
                    observed_generation,
                    failed_account_id: failed_account_id.to_string(),
                    should_retry: false,
                });
                return Err(error);
            }
        };
        state.switch_attempt_generation = state.switch_attempt_generation.wrapping_add(1);
        let should_retry = match attempt {
            AutoSwitchAttempt::Unchanged => false,
            AutoSwitchAttempt::AlreadyChanged => true,
            AutoSwitchAttempt::Switched => {
                state.active_account_generation = state.active_account_generation.wrapping_add(1);
                true
            }
        };
        state.last_attempt = Some(CompletedAutoSwitchAttempt {
            observed_generation,
            failed_account_id: failed_account_id.to_string(),
            should_retry,
        });
        Ok(should_retry)
    }
}
