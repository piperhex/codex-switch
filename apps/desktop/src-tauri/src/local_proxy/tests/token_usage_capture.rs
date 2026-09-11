struct CaptureUsageFixture {
    app: tauri::App<tauri::test::MockRuntime>,
    database_path: PathBuf,
    notifications: Arc<AtomicUsize>,
}

impl CaptureUsageFixture {
    fn new() -> Self {
        use tauri::Listener;

        let mut context = tauri::test::mock_context(tauri::test::noop_assets());
        context.config_mut().identifier =
            format!("com.codex-switch.capture-test.{}", uuid::Uuid::new_v4());
        let app = tauri::test::mock_builder().build(context).unwrap();
        let database_path = token_usage_db_path(app.handle()).unwrap();
        let notifications = Arc::new(AtomicUsize::new(0));
        let observed_notifications = Arc::clone(&notifications);
        app.listen("token-usage-updated", move |_| {
            observed_notifications.fetch_add(1, AtomicOrdering::Relaxed);
        });
        Self {
            app,
            database_path,
            notifications,
        }
    }

    fn reader(&self, chunks: &[&str]) -> TokenUsageCaptureReader<tauri::test::MockRuntime> {
        let context = TokenUsageContext {
            ts: unix_now(),
            provider: "Capture test".to_string(),
            provider_id: Some("capture-test".to_string()),
            model: "gpt-test".to_string(),
            service_tier: None,
            request_hash: uuid::Uuid::new_v4().to_string(),
            started_at: Instant::now(),
            content_type: Some("text/event-stream".to_string()),
            expects_event_stream: true,
            account: None,
            session_id: None,
            session_request_id: None,
        };
        let inner = CaptureUsageChunkReader {
            chunks: chunks
                .iter()
                .map(|chunk| chunk.as_bytes().to_vec())
                .collect(),
        };
        TokenUsageCaptureReader::new(Box::new(inner), self.app.handle().clone(), context)
    }

    fn entries(&self) -> Vec<TokenUsageEntry> {
        load_token_usage_summary_entries(self.app.handle(), 0).unwrap()
    }
}

impl Drop for CaptureUsageFixture {
    fn drop(&mut self) {
        // Cleanup must not panic during unwinding and hide the original test failure.
        for result in [
            fs::remove_file(&self.database_path),
            fs::remove_dir(self.database_path.parent().unwrap()),
        ] {
            if let Err(error) = result {
                if error.kind() != io::ErrorKind::NotFound {
                    eprintln!("failed to clean up token usage test fixture: {error}");
                }
            }
        }
    }
}

struct CaptureUsageChunkReader {
    chunks: VecDeque<Vec<u8>>,
}

impl Read for CaptureUsageChunkReader {
    fn read(&mut self, target: &mut [u8]) -> io::Result<usize> {
        let Some(chunk) = self.chunks.pop_front() else {
            panic!("upstream remains open; accounting must not wait for another read");
        };
        assert!(chunk.len() <= target.len());
        target[..chunk.len()].copy_from_slice(&chunk);
        Ok(chunk.len())
    }
}

#[test]
fn token_usage_capture_records_terminal_responses_before_eof_exactly_once() {
    for event in [
        "response.completed",
        "response.incomplete",
        "response.failed",
    ] {
        let fixture = CaptureUsageFixture::new();
        let terminal = format!(
            "data: {}\n\n",
            json!({"type": event, "response": {"service_tier": "priority",
                "usage": {"input_tokens": 20, "output_tokens": 5, "total_tokens": 25}}})
        );
        let mut reader = fixture.reader(&[&terminal, &terminal, "data: [DONE]\n\n"]);
        let mut buffer = [0_u8; 1024];

        assert!(reader.read(&mut buffer).unwrap() > 0);
        let entries = fixture.entries();
        assert_eq!(
            entries.len(),
            1,
            "{event} must persist without waiting for EOF"
        );
        assert_eq!(entries[0].total_tokens, Some(25));
        assert_eq!(entries[0].service_tier.as_deref(), Some("priority"));
        assert_eq!(entries[0].model_context_window, None);
        assert!(reader.read(&mut buffer).unwrap() > 0);
        assert!(reader.read(&mut buffer).unwrap() > 0);
        drop(reader);
        assert_eq!(fixture.notifications.load(AtomicOrdering::Relaxed), 1);
        assert_eq!(
            fixture.entries().len(),
            1,
            "terminal events and drop must not duplicate usage"
        );
    }
}

#[test]
fn token_usage_capture_waits_for_final_usage_and_persists_chat_done_before_eof() {
    let fixture = CaptureUsageFixture::new();
    let first = "data: {\"usage\":{\"prompt_tokens\":10,\"completion_tokens\":0}}\n\n";
    let last = "data: {\"usage\":{\"prompt_tokens\":10,\"completion_tokens\":7}}\n\n";
    let mut reader = fixture.reader(&[first, last, "data: [DONE]\n\n"]);
    let mut buffer = [0_u8; 1024];

    assert!(reader.read(&mut buffer).unwrap() > 0);
    assert!(
        fixture.entries().is_empty(),
        "intermediate usage must not be committed"
    );
    assert!(reader.read(&mut buffer).unwrap() > 0);
    assert!(fixture.entries().is_empty());
    assert!(reader.read(&mut buffer).unwrap() > 0);
    let entries = fixture.entries();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].total_tokens, Some(17));
    drop(reader);
    assert_eq!(fixture.entries().len(), 1);
}

#[test]
fn token_usage_capture_keeps_eof_and_unterminated_final_event_fallbacks() {
    for event in [
        "data: {\"usage\":{\"input_tokens\":2,\"output_tokens\":1}}\n\n",
        "data: {\"type\":\"response.completed\",\"response\":{\"usage\":{\"total_tokens\":3}}}",
    ] {
        let fixture = CaptureUsageFixture::new();
        let mut reader = fixture.reader(&[event, ""]);
        let mut buffer = [0_u8; 1024];

        assert!(reader.read(&mut buffer).unwrap() > 0);
        assert!(fixture.entries().is_empty());
        assert_eq!(reader.read(&mut buffer).unwrap(), 0);
        assert_eq!(fixture.entries()[0].total_tokens, Some(3));
        drop(reader);
        assert_eq!(fixture.entries().len(), 1);
    }
}
