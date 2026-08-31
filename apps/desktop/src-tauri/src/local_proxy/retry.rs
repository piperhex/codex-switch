fn upstream_429_retry_timeout<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<Duration, String> {
    let seconds = read_app_settings(app)?
        .upstream_429_retry_timeout_seconds
        .clamp(
            MIN_UPSTREAM_429_RETRY_TIMEOUT_SECONDS,
            MAX_UPSTREAM_429_RETRY_TIMEOUT_SECONDS,
        );
    Ok(Duration::from_secs(seconds))
}

fn retry_upstream_request<F, S>(
    timeout: Duration,
    request: F,
    handle_quota_event: S,
) -> Result<UpstreamPayload, String>
where
    F: FnMut() -> Result<UpstreamPayload, String>,
    S: FnMut(&UpstreamPayload, UpstreamQuotaEvent) -> bool,
{
    let started_at = Instant::now();
    retry_upstream_request_with(timeout, request, handle_quota_event, |delay| {
        thread::sleep(delay.min(timeout.saturating_sub(started_at.elapsed())));
        started_at.elapsed()
    })
}

fn retry_upstream_request_with<F, S, W>(
    timeout: Duration,
    mut request: F,
    mut handle_quota_event: S,
    mut wait_before_retry: W,
) -> Result<UpstreamPayload, String>
where
    F: FnMut() -> Result<UpstreamPayload, String>,
    S: FnMut(&UpstreamPayload, UpstreamQuotaEvent) -> bool,
    W: FnMut(Duration) -> Duration,
{
    let mut retry_number = 0_u16;
    loop {
        let response = request()?;
        if response.status == 429 {
            retry_number = retry_number.saturating_add(1);
            let elapsed = wait_before_retry(upstream_429_retry_delay(retry_number));
            if elapsed >= timeout {
                let _ = handle_quota_event(&response, UpstreamQuotaEvent::RetryTimedOut);
                return Ok(response);
            }
            if is_official_quota_exhaustion(&response) {
                let _ = handle_quota_event(&response, UpstreamQuotaEvent::Retry);
            }
            continue;
        }
        return Ok(response);
    }
}
