use super::*;
use crate::{codex_home, models::AppSettings, storage};
use std::{fs, process::Command};
use tauri::Manager;

const TEST_APP_ID: &str = "CSW_HOME_RESOLUTION_TEST_APP_ID";
const TEST_EXTERNAL_HOME: &str = "CSW_HOME_RESOLUTION_TEST_EXTERNAL_HOME";

fn mock_app(id: &str) -> tauri::App<tauri::test::MockRuntime> {
    let mut context = tauri::test::mock_context(tauri::test::noop_assets());
    context.config_mut().identifier = id.into();
    tauri::test::mock_builder().build(context).unwrap()
}

#[test]
fn startup_recovers_saved_homes_with_inherited_or_custom_environment() {
    for use_external in [false, true] {
        let id = format!("dev.codex.switch.home-test.{}", uuid::Uuid::new_v4());
        let app = mock_app(&id);
        let root = app.path().app_data_dir().unwrap();
        let inherited = if use_external {
            root.join("external")
        } else {
            gui_home(app.handle()).unwrap()
        };
        let result = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "codex_home::resolution::startup_tests::startup_probe",
                "--nocapture",
            ])
            .env(TEST_APP_ID, &id)
            .env(TEST_EXTERNAL_HOME, if use_external { "1" } else { "0" })
            .env(CODEX_HOME_ENV, inherited)
            .output()
            .unwrap();
        if root.exists() {
            fs::remove_dir_all(&root).unwrap();
        }
        assert!(
            result.status.success(),
            "{}\n{}",
            String::from_utf8_lossy(&result.stdout),
            String::from_utf8_lossy(&result.stderr)
        );
    }
}

// Run only in a child so environment variables and process-wide path caches are isolated.
#[test]
fn startup_probe() {
    let Ok(id) = std::env::var(TEST_APP_ID) else {
        return;
    };
    assert!(id.starts_with("dev.codex.switch.home-test."));
    let app = mock_app(&id);
    let gui = gui_home(app.handle()).unwrap();
    let expected = if std::env::var(TEST_EXTERNAL_HOME).unwrap() == "1" {
        app.path().app_data_dir().unwrap().join("external")
    } else {
        dirs::home_dir().unwrap().join(".codex")
    };
    let mut settings = AppSettings {
        last_started_version: Some(app.package_info().version.to_string()),
        ..AppSettings::default()
    };
    codex_home::ensure_gui_entry(&mut settings.codex_homes, &gui);
    storage::write_app_settings(app.handle(), &settings).unwrap();
    initialize_paths(app.handle()).unwrap();
    assert_runtime_default(&expected);
    storage::migrate_app_settings_for_version(app.handle()).unwrap();
    let recovered = storage::read_app_settings(app.handle()).unwrap();
    assert_eq!(recovered.codex_homes.len(), 2);
    assert_eq!(
        recovered.codex_homes[0].id,
        codex_home::DEFAULT_CODEX_HOME_ID
    );
    assert_eq!(Path::new(&recovered.codex_homes[0].path), expected);
    assert!(recovered.codex_homes[0].enabled);
    assert_eq!(recovered.codex_homes[1].id, codex_home::GUI_CODEX_HOME_ID);
    assert!(!recovered.codex_homes[1].enabled);
    assert_eq!(recovered.codex_home.as_deref(), expected.to_str());
    codex_home::initialize(&recovered);
    assert_runtime_default(&expected);
    storage::migrate_app_settings_for_version(app.handle()).unwrap();
    assert_eq!(
        storage::read_app_settings(app.handle())
            .unwrap()
            .codex_homes,
        recovered.codex_homes
    );
}

fn assert_runtime_default(expected: &Path) {
    assert_eq!(resolve_default().unwrap(), expected);
    assert_eq!(resolve_for_override(None).unwrap(), expected);
    assert_eq!(resolve().unwrap(), expected);
    let all = resolve_all().unwrap();
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].path, expected);
}
