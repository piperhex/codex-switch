use super::*;
use crate::local_proxy::{
    credential_can_trigger_auto_switch, retry_upstream_request_with, TokenUsageAccount,
    UpstreamQuotaEvent,
};
use serde_json::json;
use std::{cell::Cell, time::Duration};

fn error_response(error: Value) -> UpstreamPayload {
    UpstreamPayload {
        status: 429,
        content_type: Some("application/json".to_string()),
        response_headers: Vec::new(),
        body: UpstreamBody::Buffered(serde_json::to_vec(&json!({ "error": error })).unwrap()),
        token_usage_service_tier: None,
        token_usage_account: Some(TokenUsageAccount {
            account_id: "exhausted".to_string(),
            account_email: String::new(),
            active_account_generation: 0,
            auto_switch_attempt_generation: 0,
            auto_switch_eligible: true,
            concurrent_request_started_at: None,
        }),
    }
}

#[test]
fn recognizes_explicit_quota_identifiers_in_type_and_code() {
    for field in ["type", "code"] {
        for identifier in [
            CODEX_USAGE_LIMIT_REACHED_ERROR_TYPE,
            INSUFFICIENT_QUOTA_ERROR_CODE,
        ] {
            let response = error_response(json!({ (field): identifier }));
            assert!(
                is_official_quota_exhaustion(&response),
                "{field}: {identifier}"
            );
        }
    }
}

#[test]
fn quota_code_is_recognized_when_error_type_is_generic() {
    let response = error_response(json!({
        "type": "invalid_request_error",
        "code": "insufficient_quota"
    }));
    assert!(is_official_quota_exhaustion(&response));
}

#[test]
fn transient_limits_and_message_mentions_do_not_trigger_quota_switches() {
    for error in [
        json!({ "type": "tokens", "code": "rate_limit_exceeded" }),
        json!({ "type": "rate_limit_error", "code": "rate_limit_reached" }),
        json!({ "message": "usage_limit_reached or insufficient_quota" }),
        json!({ "type": "usage_not_included" }),
        json!({ "type": null, "code": 429 }),
    ] {
        assert!(!is_official_quota_exhaustion(&error_response(error)));
    }
}

#[test]
fn quota_identifiers_still_require_http_429() {
    let mut response = error_response(json!({ "code": "usage_limit_reached" }));
    for status in [200, 400, 401, 403, 500] {
        response.status = status;
        assert!(!is_official_quota_exhaustion(&response), "status {status}");
    }
}

#[test]
fn quota_code_reaches_the_switch_callback_and_retries_the_request() {
    for identifier in [
        CODEX_USAGE_LIMIT_REACHED_ERROR_TYPE,
        INSUFFICIENT_QUOTA_ERROR_CODE,
    ] {
        let switched = Cell::new(false);
        let mut attempts = 0;
        let response = retry_upstream_request_with(
            Duration::from_secs(10),
            || {
                attempts += 1;
                assert!(attempts <= 2, "Quota error was retried without switching");
                let mut response = error_response(json!({ "code": identifier }));
                if switched.get() {
                    response.status = 200;
                }
                Ok(response)
            },
            |_, event| {
                assert!(matches!(event, UpstreamQuotaEvent::Retry { .. }));
                switched.set(true);
                true
            },
            |_| Duration::ZERO,
        )
        .unwrap();
        assert_eq!(response.status, 200);
        assert_eq!(attempts, 2);
    }
}

#[test]
fn quota_code_does_not_make_a_fallback_credential_eligible_to_switch() {
    let mut response = error_response(json!({ "code": "insufficient_quota" }));
    let account = response.token_usage_account.as_mut().unwrap();
    account.auto_switch_eligible = false;
    assert!(!credential_can_trigger_auto_switch(account));
    assert!(is_official_quota_exhaustion(&response));
}
