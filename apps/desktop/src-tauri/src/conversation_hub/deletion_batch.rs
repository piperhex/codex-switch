use super::*;

struct PreparedDeletion {
    folder: PathBuf,
    manifest: BinManifest,
    targets: Vec<(PathBuf, PathBuf)>,
    files_moved: bool,
    state_touched: bool,
}

/// Back up every relation before removing any row shared by a parent and its child.
pub(super) fn discard(
    home: &Path,
    bin: &Path,
    snapshots: Vec<RolloutSnapshot>,
) -> Result<(), String> {
    let batch = bin.join(format!(
        "{}-{}",
        Utc::now().format("%Y%m%d-%H%M%S"),
        Uuid::new_v4()
    ));
    let mut prepared = snapshots
        .into_iter()
        .map(|snapshot| prepare(home, &batch, snapshot))
        .collect::<Result<Vec<_>, _>>()?;
    if let Err(error) = commit(home, &mut prepared) {
        return Err(with_bin_rollback_error(
            error,
            rollback(home, &mut prepared),
        ));
    }
    Ok(())
}

fn prepare(
    home: &Path,
    batch: &Path,
    snapshot: RolloutSnapshot,
) -> Result<PreparedDeletion, String> {
    let folder = batch.join(Uuid::new_v4().to_string());
    let targets = snapshot
        .physical_paths
        .iter()
        .map(|source| {
            let relative = bin_rollout_relative(source, home)?;
            Ok((source.clone(), folder.join("files").join(relative)))
        })
        .collect::<Result<Vec<_>, String>>()?;
    let manifest = bin_manifest_for_snapshot(home, snapshot)?;
    write_bin_manifest(&folder, &manifest)?;
    Ok(PreparedDeletion {
        folder,
        manifest,
        targets,
        files_moved: false,
        state_touched: false,
    })
}

fn commit(home: &Path, prepared: &mut [PreparedDeletion]) -> Result<(), String> {
    for item in prepared.iter_mut() {
        move_bin_files(&item.targets)?;
        item.files_moved = true;
    }
    for item in prepared.iter_mut() {
        item.state_touched = true;
        finish_bin_removal(home, &item.manifest.session_id)?;
    }
    for item in prepared {
        item.manifest.detached = true;
        write_bin_manifest(&item.folder, &item.manifest)?;
    }
    Ok(())
}

fn rollback(home: &Path, prepared: &mut [PreparedDeletion]) -> Result<(), String> {
    let mut failures = Vec::new();
    for item in prepared.iter().filter(|item| item.state_touched) {
        for result in [
            restore_bin_state(home, &item.manifest),
            append_index_entry(
                home,
                &item.manifest.session_id,
                &item.manifest.session_index_entry,
            ),
        ] {
            if let Err(error) = result {
                failures.push(error);
            }
        }
    }
    for item in prepared {
        if item.files_moved {
            if let Err(error) = rollback_bin_files(&item.targets) {
                failures.push(error);
            }
        }
        item.manifest.detached = false;
        if let Err(error) = write_bin_manifest(&item.folder, &item.manifest) {
            failures.push(error);
        }
    }
    if failures.is_empty() {
        Ok(())
    } else {
        Err(failures.join("；"))
    }
}
