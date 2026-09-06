use std::{
    future::Future,
    path::PathBuf,
    sync::mpsc,
    task::{Context, Waker},
    thread,
    time::Duration,
};

use serde_json::{json, Value};

use super::*;
use crate::{models::UsageWindow, storage::write_json_atomic};

const OBSERVED_TS: i64 = 1_700_000_000;
const TEST_WAIT: Duration = Duration::from_secs(3);

fn fixture() -> (PathBuf, Paths) {
    let root = std::env::temp_dir().join(format!(
        "codex-switch-quota-history-{}",
        uuid::Uuid::new_v4()
    ));
    let paths = Paths {
        current_auth: root.join("codex/auth.json"),
        current_config: root.join("codex/config.toml"),
        codex_home: root.join("codex"),
        accounts: root.join("accounts"),
        providers: root.join("providers"),
        config_backup: root.join("config-backup.toml"),
        state_file: root.join("state.json"),
    };
    (root, paths)
}

fn sample_usage() -> UsageSummary {
    UsageSummary {
        primary: Some(UsageWindow {
            used_percent: 35.0,
            remaining_percent: 65.0,
            resets_at: Some(OBSERVED_TS + 3_600),
            window_minutes: Some(300),
        }),
        fetched_at: Some("2023-11-14T22:13:20Z".to_string()),
        ..UsageSummary::default()
    }
}

fn store_auth(paths: &Paths, directory_id: &str, auth: &Value) {
    write_json_atomic(&paths.accounts.join(directory_id).join("auth.json"), auth).unwrap();
}

fn opaque_auth() -> Value {
    json!({ "tokens": {
        "access_token": "opaque-token", "email": "cloud@example.test",
        "account_id": "upstream-account", "chatgpt_user_id": "user-123"
    } })
}

fn identity_auth() -> Value {
    json!({ "auth_mode": "agentIdentity", "agent_identity": {
        "agent_runtime_id": "runtime", "agent_private_key": "test-key",
        "account_id": "identity-account", "chatgpt_user_id": "agent-user",
        "email": "agent@example.test"
    } })
}

#[test]
fn directory_ids_link_persisted_history_for_cloud_agent_and_unreadable_accounts() {
    let (root, paths) = fixture();
    let auth = opaque_auth();
    let (_, _, _, local_id) = account_fields(&auth).unwrap();
    store_auth(&paths, &local_id, &auth);
    store_auth(&paths, "managed-identity-directory", &identity_auth());
    store_auth(&paths, "unreadable", &json!({}));
    store_auth(&paths, "no-samples", &auth);
    write_json_atomic(
        &paths
            .accounts
            .join(&local_id)
            .join("official-account-access.json"),
        &json!({ "official": true, "metadataEditable": false }),
    )
    .unwrap();
    for id in [&local_id, "managed-identity-directory", "unreadable"] {
        record_usage(&paths, id, &sample_usage()).unwrap();
    }
    let histories =
        list_history(&paths, HistoryRange::new(OBSERVED_TS, OBSERVED_TS).unwrap()).unwrap();
    let histories: BTreeMap<_, _> = histories
        .into_iter()
        .map(|history| (history.account_id.clone(), history))
        .collect();
    assert_eq!(histories.len(), 4);
    assert_eq!(histories[&local_id].account_label, "cloud@example.test");
    assert_eq!(
        histories["managed-identity-directory"].account_label,
        "agent@example.test"
    );
    assert_eq!(histories["unreadable"].account_label, "未命名账户");
    for id in [&local_id, "managed-identity-directory", "unreadable"] {
        assert_eq!(
            histories[id].points[0].primary_remaining_percent,
            Some(65.0)
        );
    }
    assert!(histories["no-samples"].points.is_empty());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn history_lock_contention_yields_the_async_caller() {
    let mut context = tauri::test::mock_context(tauri::test::noop_assets());
    let identifier = format!("com.codex-switch.quota-test.{}", uuid::Uuid::new_v4());
    context.config_mut().identifier = identifier.clone();
    let app = tauri::test::mock_builder().build(context).unwrap();
    let paths = resolve_paths(app.handle()).unwrap();
    let root = paths.accounts.parent().unwrap().to_owned();
    assert_eq!(root.file_name().unwrap().to_string_lossy(), identifier);
    let (locked_sender, locked_receiver) = mpsc::channel();
    let (release_sender, release_receiver) = mpsc::channel();
    let holder = thread::spawn(move || {
        let _guard = database::acquire_lock().unwrap();
        locked_sender.send(()).unwrap();
        release_receiver.recv_timeout(TEST_WAIT)
    });
    locked_receiver.recv_timeout(TEST_WAIT).unwrap();
    let mut history = std::pin::pin!(list_account_quota_history(
        app.handle().clone(),
        0,
        Some(OBSERVED_TS)
    ));
    let mut context = Context::from_waker(Waker::noop());
    assert!(history.as_mut().poll(&mut context).is_pending());
    release_sender.send(()).unwrap();
    holder
        .join()
        .unwrap()
        .expect("async caller blocked on the database lock");
    assert!(tauri::async_runtime::block_on(history).unwrap().is_empty());
    fs::remove_dir_all(root).unwrap();
}
