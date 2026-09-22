/// Keeps the forwarded speed separate from response metadata when estimating usage.
#[derive(Clone, Default)]
pub(super) struct UsageServiceTier {
    requested: Option<String>,
    reported: Option<String>,
    source: EstimateTierSource,
}

#[derive(Clone, Default)]
enum EstimateTierSource {
    CodexSubscription,
    #[default]
    ApiResponse,
}

impl UsageServiceTier {
    pub(super) fn new(requested: Option<String>, official_account: bool) -> Self {
        Self {
            requested,
            reported: None,
            source: if official_account {
                EstimateTierSource::CodexSubscription
            } else {
                EstimateTierSource::ApiResponse
            },
        }
    }

    pub(super) fn observe_response(&mut self, reported: Option<String>) {
        if reported.is_some() {
            self.reported = reported;
        }
    }

    pub(super) fn for_estimate(&self) -> Option<&str> {
        // Subscription estimates follow the explicit speed forwarded for this request.
        // Codex responses can report "default" even when that selection was "priority".
        // API providers retain response precedence so actual downgrades are not overestimated.
        if matches!(self.source, EstimateTierSource::CodexSubscription)
            && matches!(
                self.requested.as_deref(),
                Some("default" | "priority" | "fast")
            )
        {
            return self.requested.as_deref();
        }
        self.reported.as_deref().or(self.requested.as_deref())
    }
}

#[cfg(test)]
mod tests {
    use super::UsageServiceTier;

    #[test]
    fn subscription_estimates_preserve_each_explicit_forwarded_speed() {
        for requested in ["priority", "fast", "default"] {
            let mut tier = UsageServiceTier::new(Some(requested.into()), true);
            for reported in [Some("default"), Some("priority"), None, Some("fast")] {
                tier.observe_response(reported.map(str::to_owned));
                assert_eq!(tier.for_estimate(), Some(requested));
            }
        }
    }

    #[test]
    fn api_estimates_follow_the_last_reported_tier_including_downgrades() {
        let mut tier = UsageServiceTier::new(Some("priority".into()), false);
        assert_eq!(tier.for_estimate(), Some("priority"));
        tier.observe_response(Some("fast".into()));
        assert_eq!(tier.for_estimate(), Some("fast"));
        tier.observe_response(Some("default".into()));
        tier.observe_response(None);
        assert_eq!(tier.for_estimate(), Some("default"));
    }

    #[test]
    fn unknown_subscription_speeds_keep_response_precedence() {
        for requested in [None, Some("auto"), Some("flex")] {
            let mut tier = UsageServiceTier::new(requested.map(str::to_owned), true);
            assert_eq!(tier.for_estimate(), requested);
            tier.observe_response(Some("priority".into()));
            assert_eq!(tier.for_estimate(), Some("priority"));
            tier.observe_response(Some("default".into()));
            assert_eq!(tier.for_estimate(), Some("default"));
        }
    }
}
