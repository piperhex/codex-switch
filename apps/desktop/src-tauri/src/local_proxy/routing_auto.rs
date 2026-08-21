fn upstream_429_retry_delay(retry_number: u16) -> Duration {
    let additional_seconds =
        u64::from(retry_number.saturating_sub(1)).saturating_mul(UPSTREAM_429_DELAY_STEP_SECONDS);
    Duration::from_secs(UPSTREAM_429_INITIAL_DELAY_SECONDS.saturating_add(additional_seconds))
}

fn try_switch_official_account_after_quota<R: Runtime>(
    app: &tauri::AppHandle<R>,
    response: &UpstreamPayload,
) -> bool {
    let Some(account) = response
        .token_usage_account
        .as_ref()
        .filter(|account| credential_can_trigger_auto_switch(account))
    else {
        return false;
    };
    match auto_switch_official_account(
        app,
        account.active_account_generation,
        account.auto_switch_attempt_generation,
        &account.account_id,
    ) {
        Ok(switched) => switched,
        Err(error) => {
            eprintln!(
                "failed to automatically switch official account after quota exhaustion: {error}"
            );
            false
        }
    }
}

fn credential_can_trigger_auto_switch(account: &TokenUsageAccount) -> bool {
    account.auto_switch_eligible
}

fn is_official_quota_exhaustion(payload: &UpstreamPayload) -> bool {
    if payload.status == 429 {
        return true;
    }
    if payload.status != 403 {
        return false;
    }
    let UpstreamBody::Buffered(body) = &payload.body else {
        return false;
    };
    let message = String::from_utf8_lossy(body).to_ascii_lowercase();
    [
        "quota",
        "usage_limit",
        "rate_limit",
        "rate limit",
        "limit reached",
        "额度",
        "配额",
    ]
    .iter()
    .any(|signal| message.contains(signal))
}

fn auto_switch_official_account<R: Runtime>(
    app: &tauri::AppHandle<R>,
    observed_generation: u64,
    observed_attempt_generation: u64,
    failed_account_id: &str,
) -> Result<bool, String> {
    let should_retry = auto_switch_coordinator().switch_or_wait(
        observed_generation,
        observed_attempt_generation,
        failed_account_id,
        || try_auto_switch_official_account(app, failed_account_id),
    )?;
    if !should_retry {
        return Ok(false);
    }

    // The retry resolves the active target again. A successful automatic fallback may now
    // point at either another official account or the configured third-party Provider.
    let state = read_state(&resolve_paths(app)?);
    Ok(state.active_provider_id.is_some()
        || state.active_provider_group.is_some()
        || state.active_account_id.is_some())
}

fn try_auto_switch_official_account<R: Runtime>(
    app: &tauri::AppHandle<R>,
    failed_account_id: &str,
) -> Result<AutoSwitchAttempt, String> {
    let paths = resolve_paths(app)?;
    let state = read_state(&paths);
    if !state.auto_switch_on_quota_exhaustion || state.active_provider_id.is_some() {
        return Ok(AutoSwitchAttempt::Unchanged);
    }
    let Some(current_id) = state.active_account_id else {
        return Ok(AutoSwitchAttempt::Unchanged);
    };

    // A manual official-account switch also makes the failed request stale. Retry against
    // it without advancing the automatic-switch generation or switching away from it.
    if current_id != failed_account_id {
        return Ok(AutoSwitchAttempt::AlreadyChanged);
    }

    // The quota result that triggered this flow can be stale, so refresh every enabled
    // official account before choosing a replacement instead of relying on cached usage.
    let accounts = crate::commands::list_accounts_blocking(app.clone())?;
    if !accounts
        .iter()
        .any(|account| account.id == current_id && account.auto_switch_enabled)
    {
        return Ok(AutoSwitchAttempt::Unchanged);
    }
    let mut refreshed_accounts = Vec::new();
    let mut backup_usage_unknown = false;
    for mut account in accounts
        .into_iter()
        .filter(|account| account.auto_switch_enabled)
    {
        match crate::commands::refresh_usage_blocking(app.clone(), account.id.clone()) {
            Ok(usage) => {
                account.usage = usage;
                refreshed_accounts.push(account);
            }
            Err(error) => {
                if account.id != current_id {
                    backup_usage_unknown = true;
                }
                eprintln!(
                    "failed to refresh usage for {} during automatic switch: {error}",
                    account.id
                );
            }
        }
    }

    // Do not overwrite a manual account or Provider switch made while usage was refreshing.
    let state = read_state(&paths);
    if !state.auto_switch_on_quota_exhaustion || state.active_provider_id.is_some() {
        return Ok(AutoSwitchAttempt::Unchanged);
    }
    if state.active_account_id.as_deref() != Some(&current_id) {
        return Ok(if state.active_account_id.is_some() {
            AutoSwitchAttempt::AlreadyChanged
        } else {
            AutoSwitchAttempt::Unchanged
        });
    }

    if let Some(target) = account_with_lowest_remaining_primary_quota(
        &refreshed_accounts,
        &current_id,
        state.custom_auto_switch_priority_enabled,
    ) {
        let target_id = target.id.clone();
        if let Err(error) = crate::commands::switch_account_blocking(app.clone(), target_id.clone())
        {
            // switch_account writes the selected account before emitting UI events. If a
            // post-switch side effect failed, the new account is still active and concurrent
            // quota responses must be released to retry against it.
            let state = read_state(&paths);
            if state.active_provider_id.is_none()
                && state.active_account_id.as_deref() == Some(&target_id)
            {
                eprintln!(
                    "automatic account switch to {target_id} completed with a post-switch error: {error}"
                );
                return Ok(AutoSwitchAttempt::Switched);
            }
            return Err(error);
        }
        return Ok(AutoSwitchAttempt::Switched);
    }

    if backup_usage_unknown
        || !all_backup_accounts_have_exhausted_primary_quota(&refreshed_accounts, &current_id)
    {
        return Ok(AutoSwitchAttempt::Unchanged);
    }
    let Some(provider_id) = state.auto_switch_provider_id else {
        return Ok(AutoSwitchAttempt::Unchanged);
    };
    let provider = providers::read_provider(&paths, &provider_id)?;
    if provider.kind != ProviderKind::Custom {
        return Ok(AutoSwitchAttempt::Unchanged);
    }
    if let Err(error) = providers::switch_provider_blocking(app.clone(), provider_id.clone()) {
        let state = read_state(&paths);
        if state.active_provider_id.as_deref() == Some(&provider_id) {
            eprintln!(
                "automatic fallback to Provider {provider_id} completed with a post-switch error: {error}"
            );
            return Ok(AutoSwitchAttempt::Switched);
        }
        return Err(error);
    }
    Ok(AutoSwitchAttempt::Switched)
}

fn all_backup_accounts_have_exhausted_primary_quota(
    accounts: &[AccountSummary],
    current_id: &str,
) -> bool {
    accounts
        .iter()
        .filter(|account| account.id != current_id && account.auto_switch_enabled)
        .all(|account| {
            account.usage.error.is_none()
                && account
                    .usage
                    .primary
                    .as_ref()
                    .is_some_and(|primary| primary.remaining_percent <= 0.0)
        })
}

fn account_with_lowest_remaining_primary_quota<'a>(
    accounts: &'a [AccountSummary],
    current_id: &str,
    custom_priority_enabled: bool,
) -> Option<&'a AccountSummary> {
    accounts
        .iter()
        .filter(|account| account.id != current_id)
        .filter(|account| account.auto_switch_enabled)
        .filter_map(|account| {
            primary_remaining_quota_score(&account.usage).map(|score| (account, score))
        })
        .min_by(|(left_account, left_usage), (right_account, right_usage)| {
            let priority_order = if custom_priority_enabled {
                left_account
                    .auto_switch_priority
                    .cmp(&right_account.auto_switch_priority)
            } else {
                std::cmp::Ordering::Equal
            };
            priority_order.then_with(|| {
                left_usage
                    .partial_cmp(right_usage)
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
        })
        .map(|(account, _)| account)
}
