#[cfg(test)]
mod tests {
    use std::fs;

    use super::{
        apply_app_settings_version_migration, should_activate_import,
        should_sync_current_as_active, write_managed_auth_if_unchanged, write_text_if_changed,
    };
    use crate::models::{AppSettings, ManagerStateFile, DEFAULT_CLOUD_BASE_URL};
    use crate::storage::{managed_auth_path, read_json, write_json_atomic, Paths};
    use serde_json::json;

    fn test_paths() -> Paths {
        let root = std::env::temp_dir().join(format!(
            "codex-switch-storage-test-{}",
            uuid::Uuid::new_v4()
        ));
        Paths {
            current_auth: root.join("codex-home/auth.json"),
            current_config: root.join("codex-home/config.toml"),
            codex_home: root.join("codex-home"),
            accounts: root.join("app-data/accounts"),
            providers: root.join("app-data/providers"),
            config_backup: root.join("app-data/config-before-provider.toml"),
            state_file: root.join("app-data/state.json"),
        }
    }

    #[test]
    fn text_is_only_replaced_when_contents_change() {
        let root = std::env::temp_dir().join(format!(
            "codex-switch-storage-test-{}",
            uuid::Uuid::new_v4()
        ));
        let path = root.join("config.toml");

        assert!(write_text_if_changed(&path, "model = \"first\"\n").unwrap());
        assert!(!write_text_if_changed(&path, "model = \"first\"\n").unwrap());
        assert_eq!(fs::read_to_string(&path).unwrap(), "model = \"first\"\n");

        assert!(write_text_if_changed(&path, "model = \"second\"\n").unwrap());
        assert_eq!(fs::read_to_string(&path).unwrap(), "model = \"second\"\n");

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn stale_request_cannot_overwrite_a_new_login_credential() {
        let paths = test_paths();
        let id = "account-1";
        let stale = json!({ "tokens": { "access_token": "stale" } });
        let refreshed_stale = json!({ "tokens": { "access_token": "refreshed-stale" } });
        let fresh_login = json!({ "tokens": { "access_token": "fresh-login" } });
        write_json_atomic(&managed_auth_path(&paths, id), &fresh_login).unwrap();

        assert!(!write_managed_auth_if_unchanged(&paths, id, &stale, &refreshed_stale).unwrap());
        assert_eq!(read_json(&managed_auth_path(&paths, id)).unwrap(), fresh_login);

        fs::remove_dir_all(paths.codex_home.parent().unwrap()).unwrap();
    }

    #[test]
    fn new_app_version_defaults_an_unconfigured_cloud_server() {
        let mut settings: AppSettings =
            serde_json::from_str(r#"{"cloudBaseUrl":null,"lastStartedVersion":"1.1.19"}"#).unwrap();

        assert!(apply_app_settings_version_migration(
            &mut settings,
            "1.1.20"
        ));
        assert_eq!(
            settings.cloud_base_url.as_deref(),
            Some(DEFAULT_CLOUD_BASE_URL)
        );
        assert_eq!(settings.last_started_version.as_deref(), Some("1.1.20"));
    }

    #[test]
    fn version_migration_preserves_a_custom_cloud_server() {
        let mut settings = AppSettings {
            cloud_base_url: Some("https://cloud.example.com".to_string()),
            last_started_version: Some("1.1.19".to_string()),
            ..AppSettings::default()
        };

        assert!(apply_app_settings_version_migration(
            &mut settings,
            "1.1.20"
        ));
        assert_eq!(
            settings.cloud_base_url.as_deref(),
            Some("https://cloud.example.com")
        );
    }

    #[test]
    fn version_migration_only_runs_once_per_version() {
        let mut settings = AppSettings {
            cloud_base_url: None,
            last_started_version: Some("1.1.20".to_string()),
            ..AppSettings::default()
        };

        assert!(!apply_app_settings_version_migration(
            &mut settings,
            "1.1.20"
        ));
        assert!(settings.cloud_base_url.is_none());
    }

    #[test]
    fn first_official_import_becomes_active_when_codex_has_no_auth() {
        assert!(should_activate_import(
            &ManagerStateFile::default(),
            false,
            false
        ));
    }

    #[test]
    fn passive_import_does_not_replace_existing_codex_auth() {
        assert!(!should_activate_import(
            &ManagerStateFile::default(),
            false,
            true
        ));
    }

    #[test]
    fn passive_import_does_not_take_over_an_active_provider() {
        let state = ManagerStateFile {
            active_provider_id: Some("provider-1".to_string()),
            ..ManagerStateFile::default()
        };

        assert!(!should_activate_import(&state, false, false));
    }

    #[test]
    fn explicit_activation_still_replaces_existing_codex_auth() {
        assert!(should_activate_import(
            &ManagerStateFile::default(),
            true,
            true
        ));
    }

    #[test]
    fn proxy_login_auth_does_not_replace_the_active_upstream_account_on_startup() {
        let state = ManagerStateFile {
            active_account_id: Some("upstream-account".to_string()),
            local_proxy_enabled: true,
            local_proxy_openai_auth_account_id: Some("login-account".to_string()),
            ..ManagerStateFile::default()
        };

        assert!(!should_sync_current_as_active(
            &state,
            "login-account",
            false,
            false
        ));
    }
}
