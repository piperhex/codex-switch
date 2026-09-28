use super::*;

struct Fixture {
    root: PathBuf,
    home: PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("csw-remote-test-{}", uuid::Uuid::new_v4()));
        let home = root.join("home");
        fs::create_dir_all(&home).unwrap();
        Self { root, home }
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.root).unwrap();
    }
}

#[test]
fn one_install_grants_both_directions_and_disable_revokes_old_helpers() {
    let f = Fixture::new();
    fs::write(f.home.join("config.toml"), "model = 'existing'\n").unwrap();
    install(&f.root, &f.home).unwrap();
    let (id, token) = state::incoming(&f.root).unwrap();
    assert!(state::authorized(&f.root, &id, &token));
    assert!(configured(&f.home, true).unwrap());
    assert!(fs::read_to_string(f.home.join("config.toml"))
        .unwrap()
        .contains("existing"));
    disable(&f.root, &f.home, false).unwrap();
    assert!(!state::authorized(&f.root, &id, &token));
    assert!(state::incoming(&f.root).is_err());
    install(&f.root, &f.home).unwrap();
    assert!(!state::authorized(&f.root, &id, &token));
    assert!(state::incoming(&f.root).is_ok());
    disable(&f.root, &f.home, true).unwrap();
    assert!(state::read(&f.root, &id).unwrap().is_none());
    assert!(state::incoming(&f.root).is_err());
    assert!(!skill_path(&f.home).exists());
}

#[test]
fn foreign_configuration_and_skill_are_preserved() {
    let f = Fixture::new();
    let config = "[mcp_servers.codex_switch_remote_command]\ncommand = 'user-owned'\n";
    fs::write(f.home.join("config.toml"), config).unwrap();
    assert!(matches!(
        install(&f.root, &f.home),
        Err(RemoteError::Conflict)
    ));
    assert_eq!(
        fs::read_to_string(f.home.join("config.toml")).unwrap(),
        config
    );
    fs::write(f.home.join("config.toml"), "").unwrap();
    fs::create_dir_all(skill_path(&f.home).parent().unwrap()).unwrap();
    fs::write(skill_path(&f.home), "My instructions").unwrap();
    assert!(matches!(
        install(&f.root, &f.home),
        Err(RemoteError::Conflict)
    ));
    assert_eq!(
        fs::read_to_string(skill_path(&f.home)).unwrap(),
        "My instructions"
    );
    assert!(state::record_path(&f.root, "../../other").is_err());
}

#[test]
fn independent_homes_keep_their_own_grants() {
    let f = Fixture::new();
    let other = f.root.join("other");
    install(&f.root, &f.home).unwrap();
    install(&f.root, &other).unwrap();
    let other_id = state::home_id(&other);
    let token = state::read(&f.root, &other_id).unwrap().unwrap().token;
    disable(&f.root, &f.home, true).unwrap();
    assert!(state::authorized(&f.root, &other_id, &token));
    assert!(state::incoming(&f.root).is_ok());
    assert!(!state::authorized(&f.root, &other_id, "wrong-token"));
}

#[test]
fn startup_repairs_owned_config_without_enabling_disabled_homes_or_rotating_tokens() {
    let f = Fixture::new();
    install(&f.root, &f.home).unwrap();
    let id = state::home_id(&f.home);
    let token = state::read(&f.root, &id).unwrap().unwrap().token;
    fs::write(f.home.join("config.toml"), "model = 'preserved'\n").unwrap();
    fs::remove_file(skill_path(&f.home)).unwrap();
    refresh_installed(&f.root).unwrap();
    assert!(configured(&f.home, true).unwrap());
    assert!(state::authorized(&f.root, &id, &token));
    disable(&f.root, &f.home, false).unwrap();
    refresh_installed(&f.root).unwrap();
    assert!(!state::authorized(&f.root, &id, &token));
    assert!(configured(&f.home, false).unwrap());
    assert!(!skill_path(&f.home).exists());
}
