fn restore_recovered_bin_state(codex_home: &Path, item: &BinSnapshot) -> Result<(), String> {
    if bin_belongs_to_home(item, codex_home) {
        return restore_bin_state(codex_home, &item.manifest);
    }
    let manifest = relocated_bin_manifest(codex_home, &item.manifest)?;
    restore_bin_state(codex_home, &manifest)
}

fn relocated_bin_manifest(codex_home: &Path, original: &BinManifest) -> Result<BinManifest, String> {
    let mut manifest = original.clone();
    let relative = safe_relative_path(&manifest.relative_rollout_path)
        .ok_or_else(|| "回收站中的会话路径无效".to_string())?;
    let target = codex_home.join(relative);
    manifest.original_rollout_path = target.clone();
    if let Some(visibility) = &mut manifest.state_visibility {
        visibility.rollout_path = target.to_string_lossy().into_owned();
    }
    if let Some(backup) = &mut manifest.state_backup {
        // Catalog host IDs and scan paths belong to the source installation. The target
        // rebuilds its own catalog from the restored thread row and rollout files.
        backup.tables.retain(|table| !table.database.starts_with(CATALOG_PREFIX));
        for row in backup.tables.iter_mut().flat_map(|snapshot| &mut snapshot.rows) {
            relocate_bin_row(row, &target);
        }
    }
    Ok(manifest)
}

fn relocate_bin_row(row: &mut SqliteRowSnapshot, target: &Path) {
    for (column, cell) in row.columns.iter().zip(&mut row.values) {
        if column == "rollout_path" {
            *cell = SqliteCell::Text(target.to_string_lossy().into_owned());
        }
    }
}
