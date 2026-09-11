use super::*;
use crate::local_proxy::{self as proxy, TokenUsageContext};
use serde_json::json;
use std::{
    future::Future,
    io::Read,
    task::Poll,
    time::{Duration, Instant},
};

fn input(name: &str, quota_usd: Option<f64>) -> SaveLocalProxyLanApiKey {
    SaveLocalProxyLanApiKey {
        id: None,
        name: name.into(),
        api_key: None,
        enabled: true,
        quota_usd,
        acknowledge_usage: false,
    }
}

#[test]
fn legacy_secret_survives_migration_with_a_stable_identity() {
    let mut state = ManagerStateFile {
        local_proxy_lan_api_key: Some(" legacy-secret ".into()),
        ..Default::default()
    };
    let previous_id = configured_keys(&state)[0].id.clone();
    save_key(&mut state, input("second", Some(5.0))).unwrap();
    assert!(state.local_proxy_lan_api_key.is_none());
    assert!(state.local_proxy_lan_api_keys_changed);
    assert_eq!(state.local_proxy_lan_api_keys.len(), 2);
    assert_eq!(state.local_proxy_lan_api_keys[0].api_key, "legacy-secret");
    assert_eq!(state.local_proxy_lan_api_keys[0].id, previous_id);
    assert!(state.local_proxy_lan_api_keys[1]
        .api_key
        .starts_with("csw-"));
}

#[test]
fn edits_keep_key_identity_and_reject_duplicate_secrets_and_invalid_quotas() {
    let mut state = ManagerStateFile::default();
    save_key(&mut state, input("first", Some(5.0))).unwrap();
    let original = state.local_proxy_lan_api_keys[0].clone();
    let mut edit = input("renamed", Some(10.0));
    edit.id = Some(original.id.clone());
    save_key(&mut state, edit).unwrap();
    assert_eq!(state.local_proxy_lan_api_keys[0].api_key, original.api_key);
    let mut duplicate = input("duplicate", None);
    duplicate.api_key = Some(original.api_key);
    assert!(matches!(
        save_key(&mut state, duplicate),
        Err(LanKeyError::Duplicate)
    ));
    for quota in [-1.0, f64::NAN, f64::INFINITY, MAX_QUOTA_USD + 1.0] {
        assert!(matches!(
            validate_input(&input("invalid", Some(quota))),
            Err(LanKeyError::InvalidQuota)
        ));
    }
    assert!(validate_input(&input("zero", Some(0.0))).is_ok());
}

#[test]
fn public_summaries_hide_short_legacy_secrets_and_clamp_exhausted_quota() {
    let mut key = legacy_key("tiny");
    key.quota_usd = Some(1.0);
    let public = summary(
        &key,
        ledger::KeyUsage {
            tokens: 25,
            cost_usd: 2.0,
            incomplete: false,
        },
    );
    assert_eq!(public.key_preview, "••••");
    assert_eq!(public.remaining_usd, Some(0.0));
    let serialized = serde_json::to_value(public).unwrap();
    assert!(serialized.get("apiKey").is_none());
    key.quota_usd = None;
    assert_eq!(
        summary(&key, ledger::KeyUsage::default()).remaining_usd,
        None
    );
}

struct Fixture {
    app: tauri::App<tauri::test::MockRuntime>,
    paths: Paths,
    key_id: String,
}

impl Fixture {
    fn new() -> Self {
        let mut context = tauri::test::mock_context(tauri::test::noop_assets());
        context.config_mut().identifier =
            format!("com.codex-switch.lan-test.{}", uuid::Uuid::new_v4());
        let app = tauri::test::mock_builder().build(context).unwrap();
        let paths = storage::resolve_paths(app.handle()).unwrap();
        let mut state = ManagerStateFile::default();
        save_key(&mut state, input("test", Some(10.0))).unwrap();
        let key_id = state.local_proxy_lan_api_keys[0].id.clone();
        storage::write_state(&paths, &state).unwrap();
        Self { app, paths, key_id }
    }

    fn context(&self, path: &str) -> TokenUsageContext {
        let _scope = RequestKeyScope::enter(Some(self.key_id.clone()));
        proxy::token_usage_context(proxy::TokenUsageRequest {
            method: &tiny_http::Method::Post,
            path,
            body: br#"{"model":"gpt-5","stream":true}"#,
            headers: &[],
            target: &proxy::ActiveTarget::Official {
                model: "gpt-5".into(),
            },
            started_at: Instant::now(),
            session_id: None,
            session_request_id: None,
        })
        .unwrap()
    }

    fn usage(&self) -> ledger::KeyUsage {
        ledger::load_all(&self.paths)
            .unwrap()
            .get(&self.key_id)
            .copied()
            .unwrap_or_default()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let Some(directory) = self.paths.state_file.parent() else {
            return;
        };
        // The unique mock application ID guarantees cleanup cannot touch normal application data.
        if directory
            .to_string_lossy()
            .contains("com.codex-switch.lan-test.")
        {
            if let Err(error) = std::fs::remove_dir_all(directory) {
                eprintln!("Failed to clean isolated LAN key test data: {error}");
            }
        }
    }
}

#[test]
fn buffered_and_streaming_captures_persist_usage_and_charge_each_terminal_event_once() {
    let fixture = Fixture::new();
    let payload = proxy::json_payload(
        200,
        json!({"usage": {
            "input_tokens": 20, "output_tokens": 5, "total_tokens": 25
        }}),
    );
    proxy::attach_token_usage_capture(
        fixture.app.handle(),
        Some(fixture.context("/v1/responses")),
        Ok(payload),
    )
    .unwrap();
    assert_eq!(fixture.usage().tokens, 25);
    let first_cost = fixture.usage().cost_usd;
    assert!(first_cost > 0.0);
    let event = concat!(
        "data: {\"type\":\"response.completed\",\"response\":{\"usage\":",
        "{\"input_tokens\":20,\"output_tokens\":5,\"total_tokens\":25}}}\n\n"
    )
    .as_bytes();
    let payload = proxy::UpstreamPayload {
        content_type: Some("text/event-stream".into()),
        body: proxy::UpstreamBody::Streaming(Box::new(std::io::Cursor::new(event.to_vec()))),
        ..proxy::json_payload(200, json!({}))
    };
    let mut context = fixture.context("/v1/responses");
    context.content_type = Some("text/event-stream".into());
    let mut payload =
        proxy::attach_token_usage_capture(fixture.app.handle(), Some(context), Ok(payload))
            .unwrap();
    let proxy::UpstreamBody::Streaming(reader) = &mut payload.body else {
        panic!("expected stream")
    };
    assert_eq!(reader.read(&mut []).unwrap(), 0);
    assert_eq!(
        fixture.usage().tokens,
        25,
        "an empty read cannot finish accounting"
    );
    let mut buffer = vec![0; event.len()];
    assert_eq!(reader.read(&mut buffer).unwrap(), event.len());
    assert_eq!(
        fixture.usage().tokens,
        50,
        "terminal usage is durable before EOF"
    );
    reader.read_to_end(&mut Vec::new()).unwrap();
    drop(payload);
    assert_eq!(
        fixture.usage().tokens,
        50,
        "EOF and Drop must not double-charge"
    );
    assert_eq!(fixture.usage().cost_usd, first_cost * 2.0);
}

#[test]
fn anthropic_partial_events_merge_and_chat_requests_require_usage() {
    let events = concat!(
        "data: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":100,",
        "\"cache_read_input_tokens\":30,\"output_tokens\":0}}}\n\n",
        "data: {\"type\":\"message_delta\",\"usage\":{\"output_tokens\":20}}\n\n",
        "data: {\"type\":\"message_stop\"}\n\n"
    );
    let usage = proxy::extract_token_usage_from_bytes(events.as_bytes(), None, true).unwrap();
    assert_eq!(usage.input_tokens, Some(100));
    assert_eq!(usage.output_tokens, Some(20));
    assert_eq!(usage.cached_tokens, Some(30));
    assert_eq!(usage.total_tokens, Some(120));
    let body = proxy::request_chat_usage(
        &tiny_http::Method::Post,
        "/v1/chat/completions",
        br#"{
        "stream":true,"stream_options":{"include_usage":false,"other":true}
    }"#
        .to_vec(),
    );
    let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(body["stream_options"]["include_usage"], true);
    assert_eq!(body["stream_options"]["other"], true);
}

fn hold_ledger_lock() -> (std::sync::mpsc::Sender<()>, std::thread::JoinHandle<bool>) {
    let (ready_sender, ready_receiver) = std::sync::mpsc::channel();
    let (release_sender, release_receiver) = std::sync::mpsc::channel();
    let worker = std::thread::spawn(move || {
        let _guard = ledger::LEDGER_LOCK.lock().unwrap();
        ready_sender.send(()).unwrap();
        release_receiver
            .recv_timeout(Duration::from_secs(5))
            .is_ok()
    });
    ready_receiver.recv_timeout(Duration::from_secs(5)).unwrap();
    (release_sender, worker)
}

#[test]
fn listing_keys_yields_while_usage_database_is_locked() {
    let fixture = Fixture::new();
    let (release, worker) = hold_ledger_lock();
    let (yielded, result) = tauri::async_runtime::block_on(async {
        let mut command =
            std::pin::pin!(list_local_proxy_lan_api_keys(fixture.app.handle().clone()));
        let initial =
            std::future::poll_fn(|context| Poll::Ready(command.as_mut().poll(context))).await;
        let yielded = initial.is_pending();
        release.send(()).unwrap();
        let result = match initial {
            Poll::Pending => command.await,
            Poll::Ready(result) => result,
        };
        (yielded, result)
    });
    assert!(worker.join().unwrap());
    assert!(yielded, "UI polling must yield while the ledger is busy");
    assert_eq!(result.unwrap().len(), 1);
}

#[test]
fn missing_usage_stays_blocked_until_the_owner_explicitly_acknowledges_it() {
    let fixture = Fixture::new();
    let payload = proxy::json_payload(200, json!({"output": []}));
    proxy::attach_token_usage_capture(
        fixture.app.handle(),
        Some(fixture.context("/v1/responses")),
        Ok(payload),
    )
    .unwrap();
    assert!(fixture.usage().incomplete);
    let mut edit = input("renamed", Some(10.0));
    edit.id = Some(fixture.key_id.clone());
    let summaries = tauri::async_runtime::block_on(save_local_proxy_lan_api_key(
        fixture.app.handle().clone(),
        edit,
    ))
    .unwrap();
    assert!(
        summaries[0].usage_incomplete,
        "a rename must not acknowledge missing costs"
    );
    let mut acknowledge = input("reviewed", Some(9.0));
    acknowledge.id = Some(fixture.key_id.clone());
    acknowledge.acknowledge_usage = true;
    let summaries = tauri::async_runtime::block_on(save_local_proxy_lan_api_key(
        fixture.app.handle().clone(),
        acknowledge,
    ))
    .unwrap();
    assert!(!summaries[0].usage_incomplete);
    assert_eq!(summaries[0].quota_usd, Some(9.0));
}

#[test]
fn invalid_prices_keep_reported_tokens_and_require_cost_review() {
    let fixture = Fixture::new();
    let path = fixture
        .paths
        .state_file
        .with_file_name("codex-usage-cost-rates.json");
    std::fs::write(path, b"invalid settings").unwrap();
    let payload = proxy::json_payload(
        200,
        json!({"usage": {
            "input_tokens": 100, "output_tokens": 20, "total_tokens": 120,
        }}),
    );
    proxy::attach_token_usage_capture(
        fixture.app.handle(),
        Some(fixture.context("/v1/responses")),
        Ok(payload),
    )
    .unwrap();
    let usage = fixture.usage();
    assert_eq!(usage.tokens, 120);
    assert!(usage.incomplete);
    assert_eq!(usage.cost_usd, 0.0);
}

#[test]
fn failed_writes_are_retained_and_recovered_once_before_admitting_more_usage() {
    let fixture = Fixture::new();
    let ledger_path = fixture
        .paths
        .state_file
        .with_file_name("local-proxy-lan-usage.sqlite3");
    std::fs::create_dir(&ledger_path).unwrap();
    let usage = ledger::KeyUsage {
        tokens: 50,
        cost_usd: 0.5,
        incomplete: false,
    };
    assert!(ledger::record(&fixture.paths, &fixture.key_id, usage).is_err());
    assert!(
        ledger::load_all(&fixture.paths).is_err(),
        "unavailable ledgers must reject admission"
    );
    std::fs::remove_dir(&ledger_path).unwrap();
    let recovered = fixture.usage();
    assert_eq!(recovered.tokens, 50);
    assert_eq!(recovered.cost_usd, 0.5);
    assert!(recovered.incomplete);
    assert_eq!(
        fixture.usage().tokens,
        50,
        "retries must not charge recovered usage again"
    );
}

#[test]
fn partial_anthropic_streams_require_review_even_if_start_event_contains_usage() {
    let fixture = Fixture::new();
    let start = concat!(
        "data: {\"type\":\"message_start\",\"message\":{\"usage\":",
        "{\"input_tokens\":20,\"output_tokens\":0}}}\n\n"
    )
    .as_bytes();
    let payload = proxy::UpstreamPayload {
        content_type: Some("text/event-stream".into()),
        body: proxy::UpstreamBody::Streaming(Box::new(std::io::Cursor::new(start.to_vec()))),
        ..proxy::json_payload(200, json!({}))
    };
    let mut payload = proxy::attach_token_usage_capture(
        fixture.app.handle(),
        Some(fixture.context("/v1/messages")),
        Ok(payload),
    )
    .unwrap();
    let proxy::UpstreamBody::Streaming(reader) = &mut payload.body else {
        panic!("expected stream")
    };
    reader.read_to_end(&mut Vec::new()).unwrap();
    drop(payload);
    assert_eq!(fixture.usage().tokens, 20);
    assert!(
        fixture.usage().incomplete,
        "partial output cannot be treated as fully accounted"
    );
}

#[test]
fn anthropic_conversion_keeps_absent_usage_distinct_from_reported_zero() {
    let fixture = Fixture::new();
    let response = json!({"status": "completed", "output": []});
    let converted = proxy::anthropic_stream::convert_response(&response, "gpt-5").unwrap();
    assert_eq!(
        converted["usage"]["input_tokens"], 0,
        "Messages clients expect integer counters"
    );
    let payload = proxy::json_payload(200, converted);
    proxy::attach_token_usage_capture(
        fixture.app.handle(),
        Some(fixture.context("/v1/messages")),
        Ok(payload),
    )
    .unwrap();
    assert!(fixture.usage().incomplete);
    let reported = proxy::anthropic_usage(Some(&json!({"input_tokens": 0, "output_tokens": 0})));
    let usage = proxy::token_usage_values_from_usage(&reported);
    assert_eq!(usage.input_tokens, Some(0));
    assert_eq!(usage.output_tokens, Some(0));
}

#[test]
fn premature_chat_stream_failures_do_not_convert_partial_usage_into_a_final_charge() {
    let fixture = Fixture::new();
    let source = concat!(
        "data: {\"choices\":[{\"delta\":{\"content\":\"hello\"}}],",
        "\"usage\":{\"prompt_tokens\":20,\"completion_tokens\":0}}\n\n"
    );
    let reader = proxy::ChatSseReader::new(
        std::io::BufReader::new(std::io::Cursor::new(source.as_bytes().to_vec())),
        "gpt-5".into(),
        proxy::CodexToolContext::default(),
        None,
    );
    let payload = proxy::UpstreamPayload {
        content_type: Some("text/event-stream".into()),
        body: proxy::UpstreamBody::Streaming(Box::new(reader)),
        ..proxy::json_payload(200, json!({}))
    };
    let mut payload = proxy::attach_token_usage_capture(
        fixture.app.handle(),
        Some(fixture.context("/v1/responses")),
        Ok(payload),
    )
    .unwrap();
    let proxy::UpstreamBody::Streaming(reader) = &mut payload.body else {
        panic!("expected stream")
    };
    reader.read_to_end(&mut Vec::new()).unwrap();
    drop(payload);
    assert_eq!(fixture.usage().tokens, 20);
    assert!(fixture.usage().incomplete);
}

#[test]
fn explicit_missing_counters_do_not_reuse_earlier_partial_counts() {
    let mut usage = Some(proxy::token_usage_values_from_usage(&json!({
        "input_tokens": 20, "output_tokens": 0,
    })));
    proxy::merge_token_usage_event(
        &mut usage,
        &json!({
            "type": "message_delta", "usage": {
                "input_tokens": 0, "output_tokens": 0,
                "input_tokens_missing": true, "output_tokens_missing": true,
            }
        }),
    );
    let usage = usage.unwrap();
    assert_eq!(usage.input_tokens, None);
    assert_eq!(usage.output_tokens, None);
    assert_eq!(usage.total_tokens, None);
}
