use serde::{Deserialize, Serialize};
use std::time::Duration;

pub(crate) const DEFAULT_SSE_IDLE_TIMEOUT_SECONDS: u64 = 120;
pub(crate) const MAX_SSE_IDLE_TIMEOUT_SECONDS: u64 = 3_600;

/// Independent response-body timeout for all proxied SSE streams.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub(crate) struct SseIdleTimeoutSettings {
    pub(crate) enabled: bool,
    pub(crate) timeout_seconds: u64,
}

impl Default for SseIdleTimeoutSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            timeout_seconds: DEFAULT_SSE_IDLE_TIMEOUT_SECONDS,
        }
    }
}

#[derive(Debug, thiserror::Error)]
#[error("Waiting time must be between 1 and 3600 seconds")]
pub(crate) struct InvalidSseIdleTimeout;

impl SseIdleTimeoutSettings {
    pub(crate) fn validate(&self) -> Result<(), InvalidSseIdleTimeout> {
        if !(1..=MAX_SSE_IDLE_TIMEOUT_SECONDS).contains(&self.timeout_seconds) {
            return Err(InvalidSseIdleTimeout);
        }
        Ok(())
    }

    pub(crate) fn duration(self) -> Option<Duration> {
        self.enabled.then(|| {
            Duration::from_secs(self.timeout_seconds.clamp(1, MAX_SSE_IDLE_TIMEOUT_SECONDS))
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_settings_keep_two_minute_timeout() {
        let settings: crate::models::AppSettings = serde_json::from_str("{}").unwrap();
        assert_eq!(
            settings.sse_idle_timeout.duration(),
            Some(Duration::from_secs(120))
        );
    }

    #[test]
    fn disabled_timeout_retains_duration_on_round_trip() {
        let settings = SseIdleTimeoutSettings {
            enabled: false,
            timeout_seconds: 600,
        };
        let saved = serde_json::to_string(&settings).unwrap();
        let restored: SseIdleTimeoutSettings = serde_json::from_str(&saved).unwrap();
        assert_eq!(restored.duration(), None);
        assert_eq!(restored.timeout_seconds, 600);
    }

    #[test]
    fn rejects_invalid_durations_even_when_disabled() {
        for seconds in [0, MAX_SSE_IDLE_TIMEOUT_SECONDS + 1, u64::MAX] {
            let settings = SseIdleTimeoutSettings {
                enabled: false,
                timeout_seconds: seconds,
            };
            assert!(settings.validate().is_err());
        }
        for seconds in [
            1,
            DEFAULT_SSE_IDLE_TIMEOUT_SECONDS,
            MAX_SSE_IDLE_TIMEOUT_SECONDS,
        ] {
            assert!(SseIdleTimeoutSettings {
                enabled: true,
                timeout_seconds: seconds
            }
            .validate()
            .is_ok());
        }
    }
}
