const BREAKDOWN_RESPONSE_TEST_TIMEOUT: Duration = Duration::from_secs(5);

fn breakdown_responsiveness_test_app() -> tauri::App<tauri::test::MockRuntime> {
    let mut context = tauri::test::mock_context(tauri::test::noop_assets());
    // A unique application directory keeps this IPC test away from the user's token database.
    context.config_mut().identifier =
        format!("com.codex-switch.breakdown-test.{}", uuid::Uuid::new_v4());
    tauri::test::mock_builder().build(context).unwrap()
}

fn hold_breakdown_database_lock() -> (std::sync::mpsc::Sender<()>, thread::JoinHandle<bool>) {
    let (locked_sender, locked_receiver) = std::sync::mpsc::channel();
    let (release_sender, release_receiver) = std::sync::mpsc::channel();
    let worker = thread::spawn(move || {
        let guard = token_usage_db_lock().lock().unwrap();
        locked_sender.send(()).unwrap();
        // Release on timeout too, so a regression fails instead of deadlocking the test process.
        let marker_completed = release_receiver
            .recv_timeout(BREAKDOWN_RESPONSE_TEST_TIMEOUT)
            .is_ok();
        drop(guard);
        marker_completed
    });
    locked_receiver
        .recv_timeout(BREAKDOWN_RESPONSE_TEST_TIMEOUT)
        .unwrap();
    (release_sender, worker)
}

async fn poll_breakdown_while_database_busy(
    app: tauri::AppHandle<tauri::test::MockRuntime>,
    release_sender: std::sync::mpsc::Sender<()>,
) -> (bool, Result<Vec<DailyTokenUsageBreakdown>, String>) {
    use std::{future::Future, task::Poll};

    let mut command = std::pin::pin!(list_token_usage_breakdown(app, 0, BREAKDOWN_TEST_THRESHOLD));
    let initial_poll =
        std::future::poll_fn(|context| Poll::Ready(command.as_mut().poll(context))).await;
    // This independent future runs on the same executor thread while the database remains locked.
    let marker_completed = async { release_sender.send(()).is_ok() }.await;
    let yielded = initial_poll.is_pending();
    let result = match initial_poll {
        Poll::Pending => command.await,
        Poll::Ready(result) => result,
    };
    (yielded && marker_completed, result)
}

#[test]
fn token_usage_breakdown_keeps_async_polling_responsive_while_database_is_busy() {
    let app = breakdown_responsiveness_test_app();
    let database_path = token_usage_db_path(app.handle()).unwrap();
    {
        let connection = open_token_usage_db(app.handle()).unwrap();
        insert_token_usage_entry(&connection, &breakdown_test_entry("responsive-request")).unwrap();
    }
    let (release_sender, worker) = hold_breakdown_database_lock();
    let (yielded, result) = tauri::async_runtime::block_on(poll_breakdown_while_database_busy(
        app.handle().clone(),
        release_sender,
    ));
    let marker_completed_before_timeout = worker.join().unwrap();
    fs::remove_file(&database_path).unwrap();
    fs::remove_dir(database_path.parent().unwrap()).unwrap();

    assert!(
        yielded,
        "the command must yield while waiting for the database"
    );
    assert!(
        marker_completed_before_timeout,
        "independent async work must finish before the lock is released"
    );
    let daily = result.unwrap();
    assert_eq!(daily.len(), 1);
    assert_eq!(daily[0].short_context_tokens, 100);
    assert_eq!(daily[0].standard_mode_tokens, 100);
}
