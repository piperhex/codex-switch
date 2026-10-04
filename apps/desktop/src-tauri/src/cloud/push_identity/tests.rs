use super::*;
use std::{sync::mpsc, thread, time::Duration};

struct Fixture(tauri::App<tauri::test::MockRuntime>);

impl Fixture {
    fn new() -> Self {
        let mut context = tauri::test::mock_context(tauri::test::noop_assets());
        context.config_mut().identifier =
            format!("com.codex-switch.push-route-test.{}", Uuid::new_v4());
        Self(tauri::test::mock_builder().build(context).unwrap())
    }

    fn settings(owner: &str) -> AppSettings {
        AppSettings {
            cloud_base_url: Some("https://example.test/api".into()),
            cloud_user_id: Some(owner.into()),
            ..AppSettings::default()
        }
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let root = self.0.path().app_data_dir().unwrap();
        assert!(root
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("com.codex-switch.push-route-test."));
        if root.exists() {
            fs::remove_dir_all(root).unwrap();
        }
    }
}

#[test]
fn notification_identity_remains_available_while_a_cloud_request_holds_credentials() {
    let fixture = Fixture::new();
    write_app_settings(fixture.0.handle(), &Fixture::settings("first")).unwrap();
    let credentials = lock_cloud_credentials().unwrap();
    let app = fixture.0.handle().clone();
    let (sender, receiver) = mpsc::channel();
    let reader = thread::spawn(move || sender.send(push_identity(&app)).unwrap());
    let result = receiver.recv_timeout(Duration::from_secs(3));
    drop(credentials);
    reader.join().unwrap();
    let identity = result
        .expect("a cloud request must not block local notification routing")
        .unwrap()
        .unwrap();
    assert_eq!(identity.owner_id, "first");
}

#[test]
fn queued_routes_keep_the_original_account_and_server_after_login_changes() {
    let fixture = Fixture::new();
    let app = fixture.0.handle();
    let first = Fixture::settings("first");
    write_app_settings(app, &first).unwrap();
    let captured = push_route(app).unwrap().unwrap();
    let mut second = Fixture::settings("second");
    second.cloud_base_url = Some("https://other.test/api".into());
    write_app_settings(app, &second).unwrap();
    initialize_push_routing(app, &first); // A late startup initialization must not restore old routing.
    assert_eq!(push_route(app).unwrap().unwrap().owner_id, "second");
    let old = push_identity_for_route(app, &captured).unwrap();
    assert_eq!(old.owner_id, "first");
    assert_eq!(old.base_url, "https://example.test/api");
    second.cloud_user_id = None;
    write_app_settings(app, &second).unwrap();
    assert!(push_route(app).unwrap().is_none());
    assert_eq!(push_identity_for_route(app, &captured).unwrap(), old);
}

#[test]
fn a_failed_settings_commit_does_not_change_the_notification_recipient() {
    let fixture = Fixture::new();
    let app = fixture.0.handle();
    initialize_push_routing(app, &Fixture::settings("first"));
    let path = crate::storage::app_settings_path(app).unwrap();
    fs::create_dir_all(&path).unwrap();
    assert!(write_app_settings(app, &Fixture::settings("second")).is_err());
    assert_eq!(push_route(app).unwrap().unwrap().owner_id, "first");
}
