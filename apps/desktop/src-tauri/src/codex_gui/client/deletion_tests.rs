use super::*;

fn response(method: &str, params: &Value) -> Value {
    match method {
        "thread/read" => json!({"thread": {"id": params["threadId"], "status": {"type": "idle"}}}),
        "thread/goal/get" => json!({"goal": null}),
        "thread/unsubscribe" => json!({"status": "unsubscribed"}),
        _ => json!({"data": [], "nextCursor": null}),
    }
}

#[tokio::test]
async fn active_child_goal_queue_or_terminal_prevents_unsubscribing_the_entire_tree() {
    for blocked in [
        "thread/read",
        "thread/goal/get",
        "thread/queue/list",
        "thread/backgroundTerminals/list",
    ] {
        let mut unsubscribed = Vec::new();
        let result = release_tree(&["parent".into(), "child".into()], |method, params| {
            if method == "thread/unsubscribe" {
                unsubscribed.push(params["threadId"].clone());
            }
            let result = if params["threadId"] == "child" && method == blocked {
                match method {
                    "thread/read" => {
                        json!({"thread": {"id": "child", "status": {"type": "active"}}})
                    }
                    "thread/goal/get" => json!({"goal": {"status": "active"}}),
                    _ => json!({"data": [{"id": "pending"}]}),
                }
            } else {
                response(method, &params)
            };
            std::future::ready(Ok(result))
        })
        .await;
        assert!(matches!(result, Err(GuiError::Busy)));
        assert!(unsubscribed.is_empty());
    }
}

#[tokio::test]
async fn all_descendants_are_checked_before_loaded_threads_are_unsubscribed() {
    let mut calls = Vec::new();
    release_tree(
        &["parent".into(), "child".into(), "archived".into()],
        |method, params| {
            calls.push((method, params["threadId"].as_str().unwrap().to_string()));
            let result = if params["threadId"] == "archived" {
                assert_eq!(method, "thread/read");
                json!({"thread": {"id": "archived", "status": {"type": "notLoaded"}}})
            } else {
                response(method, &params)
            };
            std::future::ready(Ok(result))
        },
    )
    .await
    .unwrap();
    assert_eq!(
        &calls[calls.len() - 3..],
        &[
            ("thread/read", "archived".into()),
            ("thread/unsubscribe", "parent".into()),
            ("thread/unsubscribe", "child".into()),
        ]
    );
}

#[tokio::test]
async fn refused_unsubscribe_never_allows_file_deletion() {
    let result = release_tree(&["parent".into()], |method, params| {
        std::future::ready(Ok(if method == "thread/unsubscribe" {
            json!({"status": "busy"})
        } else {
            response(method, &params)
        }))
    })
    .await;
    assert!(matches!(result, Err(GuiError::Busy)));
}

#[tokio::test]
async fn mutation_and_deletion_cannot_overlap_but_other_threads_remain_available() {
    let idle = idle_threads::IdleThreads::default();
    let mutation = idle.protect("child").await;
    assert!(idle.deletion_guard("child").await.is_err());
    drop(mutation);
    let deletion = idle.deletion_guard("child").await.unwrap();
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(10), idle.protect("child"))
            .await
            .is_err()
    );
    let unrelated = idle.deletion_guard("unrelated").await.unwrap();
    drop(unrelated);
    drop(deletion);
    assert!(idle.deletion_guard("child").await.is_ok());
}
