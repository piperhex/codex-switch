use super::*;
use rusqlite::Connection;
use std::{fs, path::Path};

struct TestHomes(PathBuf);

impl TestHomes {
    fn new() -> Self {
        Self(std::env::temp_dir().join(format!("proxy-title-test-{}", uuid::Uuid::new_v4())))
    }

    fn home(&self, name: &str) -> PathBuf {
        let path = self.0.join(name);
        fs::create_dir_all(&path).unwrap();
        path
    }
}

impl Drop for TestHomes {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}

fn write_title(home: &Path, id: &str, title: &str) {
    let connection = Connection::open(home.join("state_5.sqlite")).unwrap();
    connection
        .execute_batch("CREATE TABLE IF NOT EXISTS threads (id TEXT PRIMARY KEY, title TEXT);")
        .unwrap();
    connection
        .execute(
            "INSERT OR REPLACE INTO threads VALUES (?1, ?2)",
            [id, title],
        )
        .unwrap();
}

#[test]
fn gui_titles_are_found_when_gui_home_is_not_enabled_for_sync() {
    let fixture = TestHomes::new();
    let primary = fixture.home("primary");
    let secondary = fixture.home("secondary");
    let gui = fixture.home("gui");
    write_title(&primary, "cli-thread", "命令行对话");
    write_title(&secondary, "secondary-thread", "其他目录对话");
    write_title(&gui, "gui-thread", "GUI 对话");
    let homes = title_homes([primary, secondary], Some(gui));
    let ids = ["cli-thread", "secondary-thread", "gui-thread", "unknown"]
        .map(str::to_string)
        .into_iter()
        .collect();

    let titles = resolve_from_homes(&homes, &ids);

    assert_eq!(titles.len(), 3);
    assert_eq!(titles["cli-thread"], "命令行对话");
    assert_eq!(titles["secondary-thread"], "其他目录对话");
    assert_eq!(titles["gui-thread"], "GUI 对话");
}

#[test]
fn unavailable_home_does_not_hide_gui_titles_and_renames_refresh() {
    let fixture = TestHomes::new();
    let broken = fixture.home("broken");
    let gui = fixture.home("gui");
    fs::write(broken.join("state_5.sqlite"), "invalid database").unwrap();
    write_title(&gui, "gui-thread", "原名称");
    let homes = title_homes([broken], Some(gui.clone()));
    let ids = HashSet::from(["gui-thread".to_string()]);

    assert_eq!(resolve_from_homes(&homes, &ids)["gui-thread"], "原名称");
    write_title(&gui, "gui-thread", "更新后的名称");
    assert_eq!(
        resolve_from_homes(&homes, &ids)["gui-thread"],
        "更新后的名称"
    );
}

#[test]
fn duplicate_homes_are_skipped_and_primary_titles_keep_precedence() {
    let fixture = TestHomes::new();
    let primary = fixture.home("primary");
    let gui = fixture.home("gui");
    write_title(&primary, "shared-thread", "主目录名称");
    write_title(&gui, "shared-thread", "副本名称");
    let homes = title_homes([primary.clone(), gui.clone()], Some(gui.clone()));
    assert_eq!(homes, vec![primary, gui]);
    let ids = HashSet::from(["shared-thread".to_string()]);
    assert_eq!(
        resolve_from_homes(&homes, &ids)["shared-thread"],
        "主目录名称"
    );
    assert!(resolve_from_homes(&homes, &HashSet::new()).is_empty());
}
