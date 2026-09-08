use super::*;
use crate::skills_market::installed::{self, InstalledSkill};
use uuid::Uuid;

struct Fixture(PathBuf);

impl Fixture {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("skill-home-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&path).unwrap();
        Self(path)
    }

    fn home(&self, name: &str) -> SkillHome {
        let home = self.0.join(name);
        SkillHome {
            root: home.join("skills"),
            registry: registry_path(&self.0, &home),
        }
    }

    fn install(&self, name: &str, version: &str) -> SkillHome {
        let home = self.home(name);
        let directory = home.root.join("market-demo");
        fs::create_dir_all(&directory).unwrap();
        fs::write(directory.join("SKILL.md"), "demo").unwrap();
        let mut registry = SkillInstallRegistry::default();
        registry.installed.insert(
            "demo".into(),
            InstalledSkill {
                directory: "market-demo".into(),
                version: version.into(),
                enabled: true,
            },
        );
        home.write(&registry).unwrap();
        home
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}

#[test]
fn toggling_and_removing_only_changes_the_selected_home() {
    let fixture = Fixture::new();
    let primary = fixture.install("primary", "1.0.0");
    let gui = fixture.install("gui", "2.0.0");
    installed::set_market_skill_enabled(&gui, "demo", false).unwrap();
    assert!(!gui.read().unwrap().installed["demo"].enabled);
    assert!(primary.read().unwrap().installed["demo"].enabled);
    assert!(primary.root.join("market-demo/SKILL.md").is_file());
    installed::remove_market_skill(&gui, "demo").unwrap();
    assert!(gui.read().unwrap().installed.is_empty());
    assert!(!gui.root.join("market-demo").exists());
    assert_eq!(primary.read().unwrap().installed["demo"].version, "1.0.0");
    assert!(primary.root.join("market-demo/SKILL.md").is_file());
}

#[test]
fn legacy_registry_is_moved_once_to_the_previous_primary_home() {
    let fixture = Fixture::new();
    let primary = fixture.0.join("primary");
    fs::write(
        fixture.0.join(LEGACY_REGISTRY),
        r#"{"installed":{"demo":{"directory":"market-demo","version":"1.0.0"}}}"#,
    )
    .unwrap();
    migrate_legacy(&fixture.0, &primary).unwrap();
    assert!(fixture
        .home("primary")
        .read()
        .unwrap()
        .installed
        .contains_key("demo"));
    assert!(fixture.home("gui").read().unwrap().installed.is_empty());
    assert!(!fixture.0.join(LEGACY_REGISTRY).exists());
    migrate_legacy(&fixture.0, &fixture.0.join("gui")).unwrap();
    assert!(fixture.home("gui").read().unwrap().installed.is_empty());
}

#[test]
fn migration_does_not_overwrite_a_scoped_registry() {
    let fixture = Fixture::new();
    let primary = fixture.install("primary", "2.0.0");
    fs::write(fixture.0.join(LEGACY_REGISTRY), r#"{"installed":{}}"#).unwrap();
    migrate_legacy(&fixture.0, &fixture.0.join("primary")).unwrap();
    assert_eq!(primary.read().unwrap().installed["demo"].version, "2.0.0");
    assert!(fixture
        .0
        .join(HOME_REGISTRIES)
        .join("legacy-backup.json")
        .is_file());
}

#[test]
fn corrupt_registry_does_not_become_an_empty_installation_list() {
    let fixture = Fixture::new();
    let home = fixture.install("primary", "1.0.0");
    fs::write(&home.registry, "invalid json").unwrap();
    assert!(matches!(home.read(), Err(RegistryError::Read)));
    assert!(installed::remove_market_skill(&home, "demo").is_err());
    assert!(home.root.join("market-demo/SKILL.md").is_file());
}
