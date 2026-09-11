use super::*;

#[test]
fn lists_only_folders_and_can_navigate_to_the_parent() {
    let root = std::env::temp_dir().join(format!("csw-project-picker-{}", uuid::Uuid::new_v4()));
    fs::create_dir(&root).unwrap();
    let root = root.canonicalize().unwrap();
    fs::create_dir(root.join("zeta")).unwrap();
    fs::create_dir(root.join("Alpha")).unwrap();
    fs::write(root.join("private.txt"), "not a folder").unwrap();
    let listing = browse(&execution_path(&root)).unwrap();
    assert_eq!(listing.entries.len(), 2);
    assert_eq!(listing.entries[0].name, "Alpha");
    assert_eq!(listing.entries[1].name, "zeta");
    assert!(!listing.truncated);
    let child = browse(&listing.entries[0].path).unwrap();
    assert_eq!(child.parent, Some(execution_path(&root)));
    assert!(child.entries.is_empty());
    assert!(browse(&execution_path(&root.join("private.txt"))).is_err());
    assert!(browse(&execution_path(&root.join("missing"))).is_err());
    assert!(root.starts_with(std::env::temp_dir().canonicalize().unwrap()));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn rejects_relative_overlong_and_control_character_paths() {
    for path in [
        "relative",
        "../parent",
        "C:\\invalid\0folder",
        "/invalid\nfolder",
    ] {
        assert!(browse(path).is_err());
    }
    assert!(browse(&"/".repeat(MAX_PATH_BYTES + 1)).is_err());
}

#[test]
fn computer_root_is_navigation_only() {
    let listing = browse("").unwrap();
    assert!(listing.directory.is_empty());
    assert_eq!(listing.parent, None);
    assert!(!listing.entries.is_empty());
    for root in listing.entries {
        assert!(Path::new(&root.path).is_absolute());
        assert_eq!(browse(&root.path).unwrap().parent, Some(String::new()));
    }
}

#[test]
fn bounds_large_folder_listings() {
    let root = std::env::temp_dir().join(format!("csw-project-picker-{}", uuid::Uuid::new_v4()));
    fs::create_dir(&root).unwrap();
    for index in 0..=MAX_ENTRIES {
        fs::create_dir(root.join(index.to_string())).unwrap();
    }
    let listing = browse(&execution_path(&root)).unwrap();
    assert_eq!(listing.entries.len(), MAX_ENTRIES);
    assert!(listing.truncated);
    assert!(root.starts_with(std::env::temp_dir()));
    fs::remove_dir_all(root).unwrap();
}
