use super::*;

#[path = "bin_test_support.rs"]
mod support;
use support::*;

#[test]
fn cross_volume_copy_preserves_content_and_never_overwrites_a_destination() {
    let fixture = Fixture::new();
    let source = fixture.root.join("source.jsonl");
    let target = fixture.root.join("target.jsonl");
    fs::write(&source, "完整会话\n").unwrap();
    copy_bin_file(&source, &target).unwrap();
    assert!(!source.exists());
    assert_eq!(fs::read_to_string(&target).unwrap(), "完整会话\n");
    fs::write(&source, "new content").unwrap();
    assert!(copy_bin_file(&source, &target).is_err());
    assert_eq!(fs::read_to_string(&source).unwrap(), "new content");
    assert_eq!(fs::read_to_string(&target).unwrap(), "完整会话\n");
}

#[test]
fn restoring_a_later_duplicate_preserves_the_already_restored_state() {
    let fixture = Fixture::new();
    let first = fixture.discard();
    let mut duplicate = first.clone();
    duplicate.folder = fixture.bin.join("batch/duplicate");
    duplicate.manifest.relative_rollout_path = "archived_sessions/rollout-copy.jsonl".into();
    duplicate.manifest.original_rollout_path =
        fixture.home.join(&duplicate.manifest.relative_rollout_path);
    let file = duplicate
        .folder
        .join("files")
        .join(&duplicate.manifest.relative_rollout_path);
    fs::create_dir_all(file.parent().unwrap()).unwrap();
    fs::copy(&first.rollouts[0], &file).unwrap();
    duplicate.rollouts = vec![file];
    write_bin_manifest(&duplicate.folder, &duplicate.manifest).unwrap();
    assert!(recover_bin_snapshot(&fixture.home, &first).unwrap());
    let restored = fixture.dump(THREAD);
    fixture.sql(
        STATE,
        "CREATE TRIGGER deny_insert BEFORE INSERT ON threads
        BEGIN SELECT RAISE(ABORT, 'restored rows must not be replaced'); END;",
    );
    assert!(recover_additional_bin_files(&fixture.home, &duplicate).unwrap());
    assert_eq!(fixture.dump(THREAD), restored);
    assert!(duplicate.manifest.original_rollout_path.is_file());
}

#[test]
fn legacy_migration_preserves_a_live_thread_at_a_different_path() {
    let fixture = Fixture::new();
    let mut entries = vec![fixture.legacy(true)];
    let live = fixture.rollout("sessions/rollout-newer.jsonl", THREAD);
    Connection::open(fixture.home.join(STATE))
        .unwrap()
        .execute(
            "UPDATE threads SET rollout_path = ?1, archived = 0, preview = 'newer' WHERE id = ?2",
            params![live.to_string_lossy(), THREAD],
        )
        .unwrap();
    let original = fixture.dump(THREAD);
    upgrade_legacy_bin_entries(&fixture.home, &mut entries).unwrap();
    assert_eq!(fixture.dump(THREAD), original);
    assert!(!entries[0].manifest.detached);
    assert!(live.is_file());
}

#[test]
fn discard_and_restore_preserve_files_all_state_rows_and_catalogs() {
    let fixture = Fixture::new();
    let original = fixture.dump(THREAD);
    let unrelated = fixture.dump(OTHER);
    let snapshot = fixture.snapshot();
    let bytes = fs::read(&snapshot.path).unwrap();
    let index = index_values(&fixture.home).unwrap();
    let item = fixture.discard();
    assert!(item.manifest.detached);
    fixture.assert_removed();
    assert_eq!(fixture.dump(OTHER), unrelated);
    assert!(!snapshot.path.exists());
    assert_eq!(fs::read(&item.rollouts[0]).unwrap(), bytes);
    assert!(!index_values(&fixture.home).unwrap().contains_key(THREAD));
    let backup = item.manifest.state_backup.as_ref().unwrap();
    assert!(backup.thread.is_some());
    assert_eq!(
        backup.tables.len(),
        DATA_TABLES.len() + 1 + CATALOGS.len() * CATALOG_TABLES.len()
    );
    assert!(recover_bin_snapshot(&fixture.home, &item).unwrap());
    assert_eq!(fixture.dump(THREAD), original);
    assert_eq!(fixture.dump(OTHER), unrelated);
    assert_eq!(fs::read(snapshot.path).unwrap(), bytes);
    assert_eq!(index_values(&fixture.home).unwrap(), index);
    assert!(fixture.entries().is_empty());
    assert!(!item.folder.exists());
    for database in CATALOGS {
        let revision = fixture.rows(database, "local_thread_catalog_metadata", "1 = 1");
        assert!(matches!(&revision[0][1], SqlValue::Integer(value) if *value > 10));
    }
}

#[test]
fn compressed_and_archived_duplicates_move_as_one_thread() {
    let fixture = Fixture::new();
    fixture.rollout("sessions/rollout-thread-a.jsonl.zst", THREAD);
    fixture.rollout("archived_sessions/rollout-copy.jsonl.zst", THREAD);
    let snapshot = fixture.snapshot();
    assert_eq!(snapshot.physical_paths.len(), 3);
    let files = snapshot
        .physical_paths
        .iter()
        .map(|path| (path.clone(), fs::read(path).unwrap()))
        .collect::<Vec<_>>();
    let item = fixture.discard();
    assert_eq!(item.rollouts.len(), 3);
    assert!(files.iter().all(|(path, _)| !path.exists()));
    fixture.assert_removed();
    assert!(recover_bin_snapshot(&fixture.home, &item).unwrap());
    for (path, bytes) in files {
        assert_eq!(fs::read(path).unwrap(), bytes);
    }
    let visibility = fixture.visibility();
    assert_eq!(visibility.archived, 0);
    assert_eq!(visibility.preview, "原始预览");
    assert!(preferred_rollout_path(Path::new(&visibility.rollout_path)).is_some());
}

#[test]
fn legacy_conversion_persists_original_visibility_and_is_idempotent() {
    let fixture = Fixture::new();
    let original = fixture.dump(THREAD);
    let legacy = fixture.legacy(true);
    assert!(!legacy.manifest.detached);
    assert!(legacy.manifest.state_backup.is_none());
    let mut entries = vec![legacy];
    upgrade_legacy_bin_entries(&fixture.home, &mut entries).unwrap();
    fixture.assert_removed();
    let persisted = fixture.entries().pop().unwrap();
    assert!(persisted.manifest.detached);
    assert!(persisted
        .manifest
        .state_backup
        .as_ref()
        .unwrap()
        .thread
        .is_some());
    let manifest = fs::read(persisted.folder.join("manifest.json")).unwrap();
    upgrade_legacy_bin_entries(&fixture.home, &mut entries).unwrap();
    assert_eq!(
        fs::read(persisted.folder.join("manifest.json")).unwrap(),
        manifest
    );
    assert!(recover_bin_snapshot(&fixture.home, &persisted).unwrap());
    assert_eq!(fixture.dump(THREAD), original);
}

#[test]
fn oldest_manifest_without_visibility_still_restores_history_and_a_valid_path() {
    let fixture = Fixture::new();
    let mut entries = vec![fixture.legacy(false)];
    assert!(entries[0].manifest.state_visibility.is_none());
    upgrade_legacy_bin_entries(&fixture.home, &mut entries).unwrap();
    assert!(recover_bin_snapshot(&fixture.home, &fixture.entries()[0]).unwrap());
    let visibility = fixture.visibility();
    assert!(Path::new(&visibility.rollout_path).is_file());
    assert_eq!(
        fixture
            .rows(HISTORY, "thread_items", "thread_id = 'thread-a'")
            .len(),
        2
    );
}

#[test]
fn legacy_duplicate_entries_each_retain_a_restorable_thread_backup() {
    let fixture = Fixture::new();
    let first = fixture.legacy(true);
    let mut second = first.clone();
    second.folder = fixture.bin.join("legacy-batch/duplicate");
    second.manifest.relative_rollout_path = "archived_sessions/rollout-copy.jsonl".into();
    second.manifest.original_rollout_path =
        fixture.home.join(&second.manifest.relative_rollout_path);
    let target = second
        .folder
        .join("files")
        .join(&second.manifest.relative_rollout_path);
    fs::create_dir_all(target.parent().unwrap()).unwrap();
    fs::copy(&first.rollouts[0], &target).unwrap();
    second.rollouts = vec![target];
    write_bin_manifest(&second.folder, &second.manifest).unwrap();
    let mut entries = vec![first, second];
    upgrade_legacy_bin_entries(&fixture.home, &mut entries).unwrap();
    for item in fixture.entries() {
        assert!(
            item.manifest
                .state_backup
                .as_ref()
                .unwrap()
                .thread
                .is_some(),
            "a duplicate must not snapshot state already removed by the first entry"
        );
    }
}

#[test]
fn interrupted_legacy_upgrade_retries_with_its_persisted_backup() {
    let fixture = Fixture::new();
    let original = fixture.dump(THREAD);
    let mut entries = vec![fixture.legacy(true)];
    let index = fixture.block_index();
    assert!(upgrade_legacy_bin_entries(&fixture.home, &mut entries).is_err());
    let mut persisted = fixture.entries();
    assert!(!persisted[0].manifest.detached);
    let backup =
        serde_json::to_value(persisted[0].manifest.state_backup.as_ref().unwrap()).unwrap();
    remove_bin_state(&fixture.home, THREAD).unwrap();
    fixture.unblock_index(&index);
    upgrade_legacy_bin_entries(&fixture.home, &mut persisted).unwrap();
    let item = fixture.entries().pop().unwrap();
    assert!(item.manifest.detached);
    assert_eq!(
        serde_json::to_value(item.manifest.state_backup.as_ref().unwrap()).unwrap(),
        backup
    );
    assert!(recover_bin_snapshot(&fixture.home, &item).unwrap());
    assert_eq!(fixture.dump(THREAD), original);
}

#[test]
fn discard_index_failure_rolls_back_files_and_every_database() {
    let fixture = Fixture::new();
    let snapshot = fixture.snapshot();
    let bytes = fs::read(&snapshot.path).unwrap();
    let original = fixture.dump(THREAD);
    let unrelated = fixture.dump(OTHER);
    let index = fixture.block_index();
    assert!(
        discard_thread_snapshot(&fixture.home, &fixture.bin.join("batch"), snapshot.clone())
            .is_err()
    );
    assert_eq!(fixture.dump(THREAD), original);
    assert_eq!(fixture.dump(OTHER), unrelated);
    assert_eq!(fs::read(snapshot.path).unwrap(), bytes);
    assert!(fixture.entries().is_empty());
    fixture.unblock_index(&index);
    fixture.discard();
    fixture.assert_removed();
}

#[test]
fn discard_catalog_trigger_failure_restores_previously_removed_history() {
    let fixture = Fixture::new();
    let snapshot = fixture.snapshot();
    let original = fixture.dump(THREAD);
    let unrelated = fixture.dump(OTHER);
    let index = fs::read(fixture.home.join(INDEX_NAME)).unwrap();
    fixture.sql(
        CATALOGS[1],
        "CREATE TRIGGER deny_delete BEFORE DELETE ON local_thread_catalog
        WHEN OLD.thread_id = 'thread-a' BEGIN SELECT RAISE(ABORT, 'injected catalog failure'); END;",
    );
    assert!(
        discard_thread_snapshot(&fixture.home, &fixture.bin.join("batch"), snapshot.clone())
            .is_err()
    );
    assert!(snapshot.path.is_file());
    assert_eq!(fixture.dump(THREAD), original);
    assert_eq!(fixture.dump(OTHER), unrelated);
    assert_eq!(fs::read(fixture.home.join(INDEX_NAME)).unwrap(), index);
    assert!(fixture.entries().is_empty());
}

#[test]
fn restore_index_failure_keeps_the_bin_retryable() {
    let fixture = Fixture::new();
    let original = fixture.dump(THREAD);
    let unrelated = fixture.dump(OTHER);
    let item = fixture.discard();
    let bytes = fs::read(&item.rollouts[0]).unwrap();
    let index = fixture.block_index();
    assert!(recover_bin_snapshot(&fixture.home, &item).is_err());
    fixture.assert_removed();
    assert_eq!(fixture.dump(OTHER), unrelated);
    assert!(!item.manifest.original_rollout_path.exists());
    assert_eq!(fs::read(&fixture.entries()[0].rollouts[0]).unwrap(), bytes);
    fixture.unblock_index(&index);
    assert!(recover_bin_snapshot(&fixture.home, &fixture.entries()[0]).unwrap());
    assert_eq!(fixture.dump(THREAD), original);
}

#[test]
fn restore_history_trigger_failure_keeps_files_and_backup_for_retry() {
    let fixture = Fixture::new();
    let original = fixture.dump(THREAD);
    let item = fixture.discard();
    let index = fs::read(fixture.home.join(INDEX_NAME)).unwrap();
    fixture.sql(
        HISTORY,
        "CREATE TRIGGER deny_restore BEFORE INSERT ON thread_items
        WHEN NEW.thread_id = 'thread-a' BEGIN SELECT RAISE(ABORT, 'injected history failure'); END;",
    );
    assert!(recover_bin_snapshot(&fixture.home, &item).is_err());
    fixture.assert_removed();
    assert!(!item.manifest.original_rollout_path.exists());
    assert_eq!(fixture.entries().len(), 1);
    assert_eq!(fs::read(fixture.home.join(INDEX_NAME)).unwrap(), index);
    fixture.sql(HISTORY, "DROP TRIGGER deny_restore;");
    assert!(recover_bin_snapshot(&fixture.home, &fixture.entries()[0]).unwrap());
    assert_eq!(fixture.dump(THREAD), original);
}

#[test]
fn restore_does_not_overwrite_an_existing_rollout() {
    let fixture = Fixture::new();
    let item = fixture.discard();
    let bytes = fs::read(&item.rollouts[0]).unwrap();
    fs::write(&item.manifest.original_rollout_path, b"newer live file").unwrap();
    assert!(!recover_bin_snapshot(&fixture.home, &item).unwrap());
    assert_eq!(
        fs::read(&item.manifest.original_rollout_path).unwrap(),
        b"newer live file"
    );
    assert_eq!(fs::read(&item.rollouts[0]).unwrap(), bytes);
    assert_eq!(fixture.entries().len(), 1);
    fixture.assert_removed();
}

#[test]
fn restore_does_not_replace_a_live_thread_with_a_different_rollout_path() {
    let fixture = Fixture::new();
    let item = fixture.discard();
    let live_path = fixture.rollout("sessions/rollout-newer.jsonl", THREAD);
    Connection::open(fixture.home.join(STATE)).unwrap().execute(
        "INSERT INTO threads VALUES (?1, ?2, 0, NULL, 'Newer preview', 'Newer live thread', 'openai')",
        params![THREAD, live_path.to_string_lossy()],
    ).unwrap();
    let live = fixture.dump(THREAD);
    let result = recover_bin_snapshot(&fixture.home, &item);
    assert!(
        !matches!(result, Ok(true)),
        "restore must reject a database identity conflict"
    );
    assert_eq!(fixture.dump(THREAD), live);
    assert!(live_path.is_file());
    assert!(!item.manifest.original_rollout_path.exists());
    assert_eq!(fixture.entries().len(), 1);
}

#[test]
fn remove_bin_state_is_idempotent_and_preserves_remote_and_unrelated_rows() {
    let fixture = Fixture::new();
    let unrelated = fixture.dump(OTHER);
    remove_bin_state(&fixture.home, THREAD).unwrap();
    fixture.assert_removed();
    let removed = fixture.dump(THREAD);
    remove_bin_state(&fixture.home, THREAD).unwrap();
    assert_eq!(fixture.dump(THREAD), removed);
    assert_eq!(fixture.dump(OTHER), unrelated);
}

#[test]
fn state_delete_trigger_rolls_back_related_rows_in_the_same_database() {
    let fixture = Fixture::new();
    let original = fixture.dump(THREAD);
    fixture.sql(
        STATE,
        "CREATE TRIGGER deny_delete BEFORE DELETE ON threads
        WHEN OLD.id = 'thread-a' BEGIN SELECT RAISE(ABORT, 'injected state failure'); END;",
    );
    assert!(remove_bin_state(&fixture.home, THREAD).is_err());
    assert_eq!(fixture.dump(THREAD), original);
}

#[test]
fn missing_required_database_keeps_the_bin_until_the_database_returns() {
    for database in [STATE, HISTORY, CATALOGS[0]] {
        let fixture = Fixture::new();
        let original = fixture.dump(THREAD);
        let item = fixture.discard();
        let path = fixture.home.join(database);
        let suspended = fixture.root.join("suspended.db");
        fs::rename(&path, &suspended).unwrap();
        assert!(
            recover_bin_snapshot(&fixture.home, &item).is_err(),
            "missing {database} must block restore"
        );
        assert!(!item.manifest.original_rollout_path.exists());
        assert_eq!(fixture.entries().len(), 1);
        fs::rename(suspended, path).unwrap();
        assert!(recover_bin_snapshot(&fixture.home, &fixture.entries()[0]).unwrap());
        assert_eq!(fixture.dump(THREAD), original);
    }
}

#[test]
fn missing_required_table_keeps_the_bin_until_the_schema_returns() {
    for (database, table) in [
        (HISTORY, "thread_items"),
        (CATALOGS[0], "local_thread_catalog"),
        (STATE, "threads"),
    ] {
        let fixture = Fixture::new();
        let original = fixture.dump(THREAD);
        let item = fixture.discard();
        fixture.sql(
            database,
            &format!("ALTER TABLE {table} RENAME TO suspended;"),
        );
        assert!(
            recover_bin_snapshot(&fixture.home, &item).is_err(),
            "missing {table} must block restore"
        );
        assert!(!item.manifest.original_rollout_path.exists());
        assert_eq!(fixture.entries().len(), 1);
        fixture.sql(
            database,
            &format!("ALTER TABLE suspended RENAME TO {table};"),
        );
        assert!(recover_bin_snapshot(&fixture.home, &fixture.entries()[0]).unwrap());
        assert_eq!(fixture.dump(THREAD), original);
    }
}
