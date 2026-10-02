use super::*;
use std::sync::{mpsc, Arc};

#[test]
fn a_busy_operation_is_rejected_without_queuing_a_restart() {
    let lock = Mutex::new(());
    let guard = try_lock(&lock).unwrap();
    assert!(matches!(try_lock(&lock), Err(ClientOperationError::Busy)));
    drop(guard);
    assert!(try_lock(&lock).is_ok());
}

#[tokio::test]
async fn success_and_failure_are_returned_to_the_caller() {
    assert_eq!(run(|| Ok(true)).await, Ok(true));
    assert_eq!(
        run::<()>(|| Err("launch failed".into())).await,
        Err("launch failed".into())
    );
}

#[tokio::test]
async fn a_stalled_launch_times_out_while_polling_remains_responsive() {
    let lock = Arc::new(Mutex::new(()));
    let worker_lock = Arc::clone(&lock);
    let (ready_send, ready_receive) = tokio::sync::oneshot::channel();
    let (release_send, release_receive) = mpsc::channel();
    let (done_send, done_receive) = tokio::sync::oneshot::channel();
    let operation = tokio::spawn(run_with_timeout(
        move || {
            let guard = try_lock(&worker_lock).map_err(|error| error.to_string())?;
            ready_send.send(()).unwrap();
            release_receive
                .recv_timeout(Duration::from_secs(5))
                .unwrap();
            drop(guard);
            done_send.send(()).unwrap();
            Ok(())
        },
        Duration::from_millis(100),
    ));
    ready_receive.await.unwrap();
    // This single-thread runtime must still service status refreshes while launch is blocked.
    tokio::time::sleep(Duration::from_millis(10)).await;
    assert!(!operation.is_finished());
    assert_eq!(
        operation.await.unwrap(),
        Err(ClientOperationError::TimedOut.to_string())
    );
    assert!(matches!(try_lock(&lock), Err(ClientOperationError::Busy)));
    release_send.send(()).unwrap();
    done_receive.await.unwrap();
    assert!(try_lock(&lock).is_ok());
}
