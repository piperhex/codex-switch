use super::*;

#[test]
fn restore_to_another_home_relocates_files_and_preserves_target_catalogs() {
    let source = Fixture::new();
    let target = Fixture::new();
    let item = source.discard();
    target.discard();
    let other = target.dump(OTHER);
    let catalogs = CATALOGS.map(|path| target.rows(path, "local_thread_catalog", "1 = 1"));
    let bytes = fs::read(&item.rollouts[0]).unwrap();
    assert!(recover_bin_snapshot(&target.home, &item).unwrap());
    let restored_path = target.home.join(&item.manifest.relative_rollout_path);
    assert_eq!(fs::read(&restored_path).unwrap(), bytes);
    assert_eq!(
        target.visibility().rollout_path,
        restored_path.to_string_lossy()
    );
    assert_eq!(target.visibility().archived, 0);
    assert_eq!(target.dump(OTHER), other);
    for (index, path) in CATALOGS.iter().enumerate() {
        assert_eq!(
            target.rows(path, "local_thread_catalog", "1 = 1"),
            catalogs[index]
        );
    }
    assert_eq!(
        target
            .rows(HISTORY, "thread_items", "thread_id = 'thread-a'")
            .len(),
        2
    );
    assert!(index_values(&target.home).unwrap().contains_key(THREAD));
    assert!(!item.folder.exists());
    source.assert_removed();
}

#[test]
fn cross_home_restore_skips_existing_identity_without_changing_either_home() {
    let source = Fixture::new();
    let target = Fixture::new();
    let item = source.discard();
    let before = target.dump(THREAD);
    assert!(!recover_bin_snapshot(&target.home, &item).unwrap());
    assert_eq!(target.dump(THREAD), before);
    assert!(item.folder.exists());
    source.assert_removed();
}

#[test]
fn cross_home_restore_rolls_back_when_required_history_is_unavailable() {
    let source = Fixture::new();
    let target = Fixture::new();
    let item = source.discard();
    target.discard();
    let before = target.dump(THREAD);
    target.sql(HISTORY, "ALTER TABLE thread_items RENAME TO suspended;");
    let error = recover_bin_snapshot(&target.home, &item).unwrap_err();
    assert!(error.contains("备份仍保留在回收站"));
    assert!(item.folder.exists());
    assert!(!target
        .home
        .join(&item.manifest.relative_rollout_path)
        .exists());
    target.sql(HISTORY, "ALTER TABLE suspended RENAME TO thread_items;");
    assert_eq!(target.dump(THREAD), before);
    assert!(recover_bin_snapshot(&target.home, &item).unwrap());
}

#[test]
fn cross_home_restore_rejects_uninitialized_home_and_keeps_backup() {
    let source = Fixture::new();
    let target = source.root.join("empty-target");
    fs::create_dir_all(&target).unwrap();
    let item = source.discard();
    assert!(recover_bin_snapshot(&target, &item)
        .unwrap_err()
        .contains("启动一次 Codex"));
    assert!(item.folder.exists());
    assert!(!target.join(&item.manifest.relative_rollout_path).exists());
}
