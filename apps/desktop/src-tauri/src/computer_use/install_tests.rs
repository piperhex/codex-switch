use super::*;

struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("computer-use-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        Self(root)
    }
    fn home(&self, name: &str) -> PathBuf {
        self.0.join(name)
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}

#[test]
fn installs_per_home_and_revokes_running_generations() {
    let fixture = Fixture::new();
    let first = fixture.home("first");
    let second = fixture.home("second");
    install_with(&fixture.0, &first, || Ok(())).unwrap();
    install_with(&fixture.0, &second, || Ok(())).unwrap();
    let id = state::home_id(&first);
    let generation = state::read(&fixture.0, &id).unwrap().unwrap().generation;
    assert!(state::allowed(&fixture.0, &id, &generation));
    assert!(configured(&first, true).unwrap());
    disable(&fixture.0, &first, false).unwrap();
    assert!(!state::allowed(&fixture.0, &id, &generation));
    assert!(configured(&first, false).unwrap());
    assert!(!skill_path(&first).exists());
    assert!(configured(&second, true).unwrap());
    install_with(&fixture.0, &first, || Ok(())).unwrap();
    assert!(!state::allowed(&fixture.0, &id, &generation));
    disable(&fixture.0, &first, true).unwrap();
    assert!(state::read(&fixture.0, &id).unwrap().is_none());
    assert!(configured(&second, true).unwrap());
}

#[test]
fn preserves_unrelated_config_and_refuses_foreign_entries() {
    let fixture = Fixture::new();
    let home = fixture.home("home");
    fs::create_dir_all(&home).unwrap();
    let original = "# custom settings\nmodel = 'gpt-5'\n[mcp_servers.other]\ncommand = 'other'\n";
    fs::write(home.join("config.toml"), original).unwrap();
    install_with(&fixture.0, &home, || Ok(())).unwrap();
    disable(&fixture.0, &home, true).unwrap();
    assert_eq!(
        fs::read_to_string(home.join("config.toml")).unwrap(),
        original
    );
    let foreign = format!("[mcp_servers.{MCP_SERVER}]\ncommand = 'custom'\nargs = ['mcp']\n");
    fs::write(home.join("config.toml"), &foreign).unwrap();
    assert!(matches!(
        install_with(&fixture.0, &home, || panic!("must not download")),
        Err(ComputerError::Conflict)
    ));
    assert_eq!(
        fs::read_to_string(home.join("config.toml")).unwrap(),
        foreign
    );
}

#[test]
fn failed_download_stays_disabled_and_can_be_repaired() {
    let fixture = Fixture::new();
    let home = fixture.home("home");
    assert!(install_with(&fixture.0, &home, || Err(ComputerError::Download)).is_err());
    let record = state::read(&fixture.0, &state::home_id(&home))
        .unwrap()
        .unwrap();
    assert!(!record.enabled);
    assert!(configured(&home, false).unwrap());
    install_with(&fixture.0, &home, || Ok(())).unwrap();
    assert!(configured(&home, true).unwrap());
    assert!(skill_matches(&home));
}

#[test]
fn preserves_user_skills_and_rejects_invalid_record_paths() {
    let fixture = Fixture::new();
    let home = fixture.home("home");
    fs::create_dir_all(skill_path(&home).parent().unwrap()).unwrap();
    fs::write(skill_path(&home), "user content").unwrap();
    assert!(matches!(
        install_with(&fixture.0, &home, || Ok(())),
        Err(ComputerError::Conflict)
    ));
    assert!(!home.join("config.toml").exists());
    assert!(state::path(&fixture.0, "../../elsewhere").is_err());
    assert!(state::path(&fixture.0, &"x".repeat(64)).is_err());
}
