//! A heartbeat cannot extend the authenticated viewer grant. Each local grant is bounded to one hour.
use super::{DesktopError, Result};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const MAX_GRANT: Duration = Duration::from_secs(3600);

fn remaining(expires_at: Option<u64>, now_ms: u64) -> Result<Duration> {
    let Some(expires_at) = expires_at else {
        return Ok(MAX_GRANT);
    };
    let millis = expires_at
        .checked_sub(now_ms)
        .filter(|value| *value > 0)
        .ok_or(DesktopError::Expired)?;
    Ok(Duration::from_millis(millis).min(MAX_GRANT))
}

pub(super) fn deadline(expires_at: Option<u64>) -> Result<Instant> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| DesktopError::Platform)?;
    Ok(Instant::now() + remaining(expires_at, now.as_millis() as u64)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn grants_are_bounded_by_authentication_and_one_hour() {
        assert_eq!(remaining(Some(2000), 1000).unwrap(), Duration::from_secs(1));
        assert_eq!(remaining(Some(u64::MAX), 1000).unwrap(), MAX_GRANT);
        assert_eq!(remaining(None, 1000).unwrap(), MAX_GRANT);
        assert!(remaining(Some(1000), 1000).is_err());
        assert!(remaining(Some(999), 1000).is_err());
    }
}
