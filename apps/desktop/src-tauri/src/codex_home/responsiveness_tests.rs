use super::*;
use std::{future::Future, sync::mpsc, task::Poll, thread, time::Duration};

#[test]
fn app_info_yields_while_home_resolution_is_locked() {
    let mut context = tauri::test::mock_context(tauri::test::noop_assets());
    context.config_mut().identifier =
        format!("com.codex-switch.app-info-test.{}", uuid::Uuid::new_v4());
    let app = tauri::test::mock_builder().build(context).unwrap();
    let (ready, acquired) = mpsc::channel();
    let (release, waiting) = mpsc::channel();
    let blocker = thread::spawn(move || {
        let guard = override_store().write().unwrap();
        ready.send(()).unwrap();
        let released = waiting.recv_timeout(Duration::from_secs(3)).is_ok();
        drop(guard);
        released
    });
    acquired.recv_timeout(Duration::from_secs(3)).unwrap();
    let (yielded, result) = tauri::async_runtime::block_on(async {
        let mut request = std::pin::pin!(crate::commands::get_app_info(app.handle().clone()));
        let initial =
            std::future::poll_fn(|context| Poll::Ready(request.as_mut().poll(context))).await;
        release.send(()).unwrap();
        let yielded = initial.is_pending();
        let result = match initial {
            Poll::Pending => request.await,
            Poll::Ready(result) => result,
        };
        (yielded, result)
    });
    assert!(
        blocker.join().unwrap(),
        "the UI caller must release the test lock before its timeout"
    );
    assert!(
        yielded,
        "home filesystem access must not run on the invoking thread"
    );
    assert!(result.is_ok());
}
