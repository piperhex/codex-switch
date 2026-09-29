use super::*;

fn old_activity() -> Instant {
    Instant::now() - IDLE_DELAY - Duration::from_secs(1)
}

#[tokio::test]
async fn only_loaded_subscriptions_expire_and_resuming_renews_them() {
    let idle = IdleThreads::default();
    let params = json!({"threadId": "one"});
    let response = json!({"thread": {"id": "one"}});
    idle.response("thread/resume", &params, &response).await;
    let thread = idle.thread("one").await;
    assert!(idle.candidates().await.is_empty());
    *thread.last_activity.lock().await = Some(old_activity());
    assert_eq!(idle.candidates().await.len(), 1);
    idle.response(
        "thread/unsubscribe",
        &params,
        &json!({"status": "unsubscribed"}),
    )
    .await;
    assert!(idle.candidates().await.is_empty());
    idle.response("thread/resume", &params, &response).await;
    assert!(Arc::ptr_eq(&thread, &idle.thread("one").await));
    assert!(thread.last_activity.lock().await.is_some());
    assert!(!thread.expired().await);
}

#[tokio::test]
async fn reads_do_not_extend_lifetime_but_turn_completion_does() {
    let idle = IdleThreads::default();
    let params = json!({"threadId": "one"});
    let thread = idle.thread("one").await;
    *thread.last_activity.lock().await = Some(old_activity());
    for method in ["thread/read", "thread/goal/get", "thread/name/set"] {
        assert!(idle.request_guard(method, &params).await.is_none());
        idle.response(method, &params, &json!({})).await;
        assert!(thread.expired().await);
    }
    idle.event("turn/completed", &params).await;
    assert!(!thread.expired().await);
    idle.event("thread/closed", &params).await;
    idle.event("turn/completed", &params).await;
    assert!(thread.last_activity.lock().await.is_none());
}

#[tokio::test]
async fn mutation_guard_prevents_cleanup_until_acknowledged_or_cancelled() {
    let idle = IdleThreads::default();
    let guard = idle
        .request_guard("turn/start", &json!({"threadId": "one"}))
        .await;
    let thread = idle.thread("one").await;
    *thread.last_activity.lock().await = Some(old_activity());
    assert!(thread.requests.clone().try_write_owned().is_err());
    // Dropping a cancelled request must release its guard without needing an RPC response.
    drop(guard);
    let cleanup = thread.requests.clone().try_write_owned().unwrap();
    assert!(thread.requests.clone().try_read_owned().is_err());
    assert!(idle
        .thread("two")
        .await
        .requests
        .clone()
        .try_write_owned()
        .is_ok());
    drop(cleanup);
    let _next = idle.protect("one").await;
    assert!(!thread.expired().await);
}

#[tokio::test]
async fn unrecognized_unsubscribe_response_leaves_cleanup_retryable() {
    let idle = IdleThreads::default();
    let thread = idle.thread("one").await;
    *thread.last_activity.lock().await = Some(old_activity());
    idle.response(
        "thread/unsubscribe",
        &json!({"threadId": "one"}),
        &json!({}),
    )
    .await;
    assert!(thread.expired().await);
}

async fn inspect(responses: Vec<(&'static str, Result<Value>)>) -> Result<ReleaseDecision> {
    let mut responses = responses.into_iter();
    let decision = inspect_thread("one", |method, params| {
        let (expected, result) = responses.next().expect("unexpected cleanup RPC");
        assert_eq!(method, expected);
        assert_eq!(params, json!({"threadId": "one"}));
        std::future::ready(result)
    })
    .await;
    assert!(responses.next().is_none());
    decision
}

fn snapshot(status: &str) -> (&'static str, Result<Value>) {
    (
        "thread/read",
        Ok(json!({"thread": {"id": "one", "status": {"type": status}}})),
    )
}

#[tokio::test]
async fn cleanup_preserves_active_unknown_and_unloaded_threads() {
    for status in ["active", "systemError", "unknown"] {
        assert_eq!(
            inspect(vec![snapshot(status)]).await.unwrap(),
            ReleaseDecision::Wait
        );
    }
    assert_eq!(
        inspect(vec![snapshot("notLoaded")]).await.unwrap(),
        ReleaseDecision::NotLoaded
    );
    assert!(inspect(vec![("thread/read", Err(GuiError::Timeout))])
        .await
        .is_err());
    assert!(inspect(vec![(
        "thread/read",
        Ok(json!({"thread": {"id": "other"}}))
    )])
    .await
    .is_err());
}

#[tokio::test]
async fn cleanup_preserves_active_goals_background_terminals_and_queued_work() {
    for goal in [
        json!({"goal": {"status": "active"}}),
        json!({}),
        json!({"goal": {"status": "unknown"}}),
    ] {
        assert_eq!(
            inspect(vec![snapshot("idle"), ("thread/goal/get", Ok(goal))])
                .await
                .unwrap(),
            ReleaseDecision::Wait
        );
    }
    for terminals in [
        json!({"data": [{"id": "server"}]}),
        json!({}),
        json!({"data": [], "nextCursor": "more"}),
    ] {
        assert_eq!(
            inspect(vec![
                snapshot("idle"),
                ("thread/goal/get", Ok(json!({"goal": null}))),
                ("thread/backgroundTerminals/list", Ok(terminals))
            ])
            .await
            .unwrap(),
            ReleaseDecision::Wait
        );
    }
    for queue in [
        json!({"data": [{"id": "queued"}]}),
        json!({}),
        json!({"data": [], "nextCursor": "more"}),
    ] {
        assert_eq!(
            inspect(vec![
                snapshot("idle"),
                ("thread/goal/get", Ok(json!({"goal": null}))),
                (
                    "thread/backgroundTerminals/list",
                    Ok(json!({"data": [], "nextCursor": null}))
                ),
                ("thread/queue/list", Ok(queue))
            ])
            .await
            .unwrap(),
            ReleaseDecision::Wait
        );
    }
}

#[tokio::test]
async fn cleanup_only_releases_a_confirmed_idle_thread_with_no_pending_work() {
    assert_eq!(
        inspect(vec![
            snapshot("idle"),
            ("thread/goal/get", Ok(json!({"goal": null}))),
            (
                "thread/backgroundTerminals/list",
                Ok(json!({"data": [], "nextCursor": null}))
            ),
            (
                "thread/queue/list",
                Ok(json!({"data": [], "nextCursor": null}))
            )
        ])
        .await
        .unwrap(),
        ReleaseDecision::Unsubscribe
    );
    assert!(inspect(vec![
        snapshot("idle"),
        ("thread/goal/get", Err(GuiError::Rpc))
    ])
    .await
    .is_err());
}
