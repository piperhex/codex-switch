use super::*;

fn test_app() -> tauri::App<tauri::test::MockRuntime> {
    let mut context = tauri::test::mock_context(tauri::test::noop_assets());
    context.config_mut().identifier =
        format!("com.codex-switch.bubble-test.{}", uuid::Uuid::new_v4());
    tauri::test::mock_builder()
        .manage(BubbleLifecycle::default())
        .build(context)
        .unwrap()
}

fn remove_settings(app: &tauri::AppHandle<tauri::test::MockRuntime>) {
    let directory = app.path().app_data_dir().unwrap();
    std::fs::remove_file(directory.join("settings.json")).unwrap();
    std::fs::remove_dir(directory).unwrap();
}

#[test]
fn enabled_bubble_recovers_from_missing_hidden_and_minimized_windows() {
    assert_eq!(recovery_action(true, None), RecoveryAction::Create);
    assert_eq!(recovery_action(true, Some(false)), RecoveryAction::Restore);
    assert_eq!(recovery_action(true, Some(true)), RecoveryAction::None);
}

#[test]
fn disabled_bubble_stays_closed_and_retries_failed_destruction() {
    assert_eq!(recovery_action(false, None), RecoveryAction::None);
    assert_eq!(recovery_action(false, Some(true)), RecoveryAction::Destroy);
    assert_eq!(recovery_action(false, Some(false)), RecoveryAction::Destroy);
}

#[test]
fn recovery_retries_after_window_creation_failure_without_changing_settings() {
    let app = test_app();
    let settings = AppSettings {
        bubble_x: Some(120.0),
        ..AppSettings::default()
    };
    write_app_settings(app.handle(), &settings).unwrap();
    let failure = reconcile_with(app.handle(), |_, _| Err("WebView unavailable".into()));
    assert!(failure.is_err());
    let mut retried = false;
    reconcile_with(app.handle(), |_, settings| {
        assert_eq!(
            recovery_action(settings.floating_bubble_enabled, None),
            RecoveryAction::Create
        );
        retried = true;
        Ok(())
    })
    .unwrap();
    assert!(retried);
    let restored = read_app_settings(app.handle()).unwrap();
    assert!(restored.floating_bubble_enabled);
    assert_eq!(restored.bubble_x, Some(120.0));
    remove_settings(app.handle());
}

#[test]
fn recovery_does_not_create_disabled_windows_or_windows_during_shutdown() {
    let app = test_app();
    let mut settings = AppSettings {
        floating_bubble_enabled: false,
        ..AppSettings::default()
    };
    write_app_settings(app.handle(), &settings).unwrap();
    reconcile(app.handle()).unwrap();
    assert!(app.get_webview_window(BUBBLE_LABEL).is_none());
    settings.floating_bubble_enabled = true;
    write_app_settings(app.handle(), &settings).unwrap();
    shutdown(app.handle());
    reconcile(app.handle()).unwrap();
    assert!(app.get_webview_window(BUBBLE_LABEL).is_none());
    remove_settings(app.handle());
}

#[test]
fn settings_command_yields_while_recovery_holds_the_lifecycle_lock() {
    use std::{future::Future, sync::mpsc, task::Poll};

    let app = test_app();
    let worker_app = app.handle().clone();
    let (locked_tx, locked_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    let worker = thread::spawn(move || {
        let state = worker_app.state::<BubbleLifecycle>();
        let _guard = state.operation.lock().unwrap();
        locked_tx.send(()).unwrap();
        release_rx.recv_timeout(Duration::from_secs(5)).is_ok()
    });
    locked_rx.recv_timeout(Duration::from_secs(5)).unwrap();
    let yielded = tauri::async_runtime::block_on(async {
        let mut command = std::pin::pin!(super::super::set_floating_bubble(
            app.handle().clone(),
            false
        ));
        let first =
            std::future::poll_fn(|context| Poll::Ready(command.as_mut().poll(context))).await;
        release_tx.send(()).unwrap();
        let yielded = first.is_pending();
        match first {
            Poll::Pending => assert!(!command.await.unwrap().floating_bubble_enabled),
            Poll::Ready(result) => {
                result.unwrap();
            }
        }
        yielded
    });
    assert!(
        worker.join().unwrap(),
        "independent work must run before the lock times out"
    );
    assert!(
        yielded,
        "settings commands must not block the executor while recovery is active"
    );
    reconcile(app.handle()).unwrap();
    assert!(app.get_webview_window(BUBBLE_LABEL).is_none());
    remove_settings(app.handle());
}
