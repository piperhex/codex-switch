pub(crate) fn discard_codex_threads_blocking<R: Runtime>(
    app: tauri::AppHandle<R>,
    session_ids: Vec<String>,
) -> Result<MutationReport, String> {
    let requested = normalized_ids(session_ids);
    if requested.is_empty() {
        return Err("请至少选择一条会话".to_string());
    }
    let paths = resolve_paths(&app)?;
    let all_snapshots = gather_snapshots(&paths.codex_home)?;
    let state_db = latest_state_db(&paths.codex_home);
    ensure_threads_are_not_referenced(&all_snapshots, &requested, state_db.as_deref())?;
    let snapshots = all_snapshots
        .into_iter()
        .filter(|item| requested.contains(&item.session_id))
        .collect::<Vec<_>>();
    if snapshots.is_empty() {
        return Ok(MutationReport {
            requested_count: requested.len(),
            affected_count: 0,
            released_bytes: 0,
            message: "所选会话已不存在".to_string(),
        });
    }
    let batch = bin_root(&app)?.join(Utc::now().format("%Y%m%d-%H%M%S").to_string());
    fs::create_dir_all(&batch).map_err(|error| format!("无法创建会话回收站：{error}"))?;
    let mut moved = HashSet::new();
    for snapshot in snapshots {
        let folder = batch.join(format!(
            "{}--{}",
            safe_name(&snapshot.session_id),
            Uuid::new_v4()
        ));
        let target = folder.join("files").join(&snapshot.relative_path);
        let state_visibility =
            state_visibility_snapshot(state_db.as_deref(), &snapshot.session_id)?;
        let manifest = BinManifest {
            session_id: snapshot.session_id.clone(),
            title: snapshot.title,
            cwd: snapshot.cwd,
            original_rollout_path: snapshot.path.clone(),
            relative_rollout_path: snapshot.relative_path.to_string_lossy().to_string(),
            session_index_entry: snapshot.index_value,
            deleted_at: Utc::now().to_rfc3339(),
            state_visibility,
        };
        let manifest_text = serde_json::to_string_pretty(&manifest)
            .map_err(|error| format!("无法生成回收站清单：{error}"))?;
        write_text_atomic(&folder.join("manifest.json"), &format!("{manifest_text}\n"))?;
        let mut moved_files = Vec::new();
        for source in &snapshot.physical_paths {
            let relative = source.strip_prefix(&paths.codex_home).unwrap_or(source);
            let target = folder.join("files").join(relative);
            fs::create_dir_all(target.parent().unwrap_or(&folder))
                .map_err(|error| format!("无法创建回收站条目：{error}"))?;
            if let Err(error) = fs::rename(source, &target) {
                restore_moved_files(&moved_files);
                return Err(format!(
                    "无法将会话移入回收站 {}：{error}",
                    source.display()
                ));
            }
            moved_files.push((source.clone(), target));
        }
        let recycle_path = moved_files
            .iter()
            .find(|(source, _)| *source == snapshot.path)
            .map(|(_, target)| target.as_path())
            .unwrap_or(target.as_path());
        if let Err(error) =
            hide_thread_in_state(state_db.as_deref(), &snapshot.session_id, recycle_path)
        {
            restore_moved_files(&moved_files);
            return Err(error);
        }
        moved.insert(snapshot.session_id);
    }
    rewrite_index(&paths.codex_home, &moved)?;
    Ok(MutationReport {
        requested_count: requested.len(),
        affected_count: moved.len(),
        released_bytes: 0,
        message: format!("已将 {} 条会话移到回收站", moved.len()),
    })
}

fn collect_bin_entries<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<Vec<BinSnapshot>, String> {
    let root = bin_root(app)?;
    if !root.exists() {
        return Ok(Vec::new());
    }
    let mut result = Vec::new();
    for batch in fs::read_dir(&root).map_err(|error| format!("无法读取会话回收站：{error}"))?
    {
        let batch = batch.map_err(|error| error.to_string())?.path();
        if !batch.is_dir() {
            continue;
        }
        for entry in fs::read_dir(&batch).map_err(|error| error.to_string())? {
            let folder = entry.map_err(|error| error.to_string())?.path();
            let manifest_path = folder.join("manifest.json");
            if !manifest_path.is_file() {
                continue;
            }
            let manifest: BinManifest = serde_json::from_slice(
                &fs::read(&manifest_path).map_err(|error| error.to_string())?,
            )
            .map_err(|error| format!("回收站清单损坏 {}：{error}", manifest_path.display()))?;
            let files_root = folder.join("files");
            let mut rollouts = Vec::new();
            collect_physical_rollouts(&files_root, &mut rollouts)?;
            if !rollouts.is_empty() {
                result.push(BinSnapshot {
                    folder,
                    manifest,
                    rollouts,
                });
            }
        }
    }
    Ok(result)
}

fn collect_physical_rollouts(root: &Path, result: &mut Vec<PathBuf>) -> Result<(), String> {
    if !root.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(root).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        if entry
            .file_type()
            .map_err(|error| error.to_string())?
            .is_dir()
        {
            collect_physical_rollouts(&path, result)?;
        } else if logical_rollout_path(&path).is_some() {
            result.push(path);
        }
    }
    result.sort();
    Ok(())
}

fn directory_size(path: &Path) -> u64 {
    if path.is_file() {
        return fs::metadata(path).map(|value| value.len()).unwrap_or(0);
    }
    fs::read_dir(path)
        .ok()
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .map(|entry| directory_size(&entry.path()))
        .sum()
}

fn latest_versioned_db(codex_home: &Path, prefix: &str) -> Option<PathBuf> {
    fs::read_dir(codex_home)
        .ok()?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().to_string();
            let version = name
                .strip_prefix(prefix)?
                .strip_suffix(".sqlite")?
                .parse::<u64>()
                .ok()?;
            Some((version, entry.path()))
        })
        .max_by_key(|(version, _)| *version)
        .map(|(_, path)| path)
}

fn table_exists(connection: &Connection, table: &str) -> Result<bool, String> {
    connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1)",
            params![table],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())
}

fn delete_thread_rows(
    path: Option<PathBuf>,
    session_id: &str,
    operations: &[(&str, &str)],
) -> Result<(), String> {
    let Some(path) = path else {
        return Ok(());
    };
    let mut connection = Connection::open(&path)
        .map_err(|error| format!("无法打开 Codex 数据库 {}：{error}", path.display()))?;
    connection
        .busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|error| error.to_string())?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    for (table, sql) in operations {
        if table_exists(&transaction, table)? {
            transaction
                .execute(sql, params![session_id])
                .map_err(|error| format!("无法清理 Codex 数据库 {}：{error}", path.display()))?;
        }
    }
    transaction.commit().map_err(|error| error.to_string())
}

fn purge_thread_catalogs(codex_home: &Path, session_id: &str) -> Result<(), String> {
    let catalog_dir = codex_home.join("sqlite");
    if !catalog_dir.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(&catalog_dir).map_err(|error| error.to_string())? {
        let path = entry.map_err(|error| error.to_string())?.path();
        if path.extension().and_then(|value| value.to_str()) != Some("db") {
            continue;
        }
        delete_thread_rows(
            Some(path),
            session_id,
            &[(
                "local_thread_catalog",
                "DELETE FROM local_thread_catalog WHERE thread_id = ?1",
            )],
        )?;
    }
    Ok(())
}

fn purge_thread_state(codex_home: &Path, session_id: &str) -> Result<(), String> {
    delete_thread_rows(
        latest_state_db(codex_home),
        session_id,
        &[
            ("thread_dynamic_tools", "DELETE FROM thread_dynamic_tools WHERE thread_id = ?1"),
            (
                "thread_spawn_edges",
                "DELETE FROM thread_spawn_edges WHERE child_thread_id = ?1 OR parent_thread_id = ?1",
            ),
            (
                "thread_goal_continuation_deferrals",
                "DELETE FROM thread_goal_continuation_deferrals WHERE thread_id = ?1",
            ),
            ("thread_goals", "DELETE FROM thread_goals WHERE thread_id = ?1"),
            ("stage1_outputs", "DELETE FROM stage1_outputs WHERE thread_id = ?1"),
            ("logs", "DELETE FROM logs WHERE thread_id = ?1"),
            ("threads", "DELETE FROM threads WHERE id = ?1"),
        ],
    )?;
    delete_thread_rows(
        latest_versioned_db(codex_home, "thread_history_"),
        session_id,
        &[
            (
                "thread_items",
                "DELETE FROM thread_items WHERE thread_id = ?1",
            ),
            (
                "thread_turns",
                "DELETE FROM thread_turns WHERE thread_id = ?1",
            ),
            (
                "thread_history_projection_state",
                "DELETE FROM thread_history_projection_state WHERE thread_id = ?1",
            ),
        ],
    )?;
    delete_thread_rows(
        latest_versioned_db(codex_home, "queue_"),
        session_id,
        &[(
            "queued_items",
            "DELETE FROM queued_items WHERE thread_id = ?1",
        )],
    )?;
    delete_thread_rows(
        latest_versioned_db(codex_home, "goals_"),
        session_id,
        &[
            (
                "thread_goal_continuation_deferrals",
                "DELETE FROM thread_goal_continuation_deferrals WHERE thread_id = ?1",
            ),
            (
                "thread_goals",
                "DELETE FROM thread_goals WHERE thread_id = ?1",
            ),
        ],
    )?;
    delete_thread_rows(
        latest_versioned_db(codex_home, "memories_"),
        session_id,
        &[(
            "stage1_outputs",
            "DELETE FROM stage1_outputs WHERE thread_id = ?1",
        )],
    )?;
    delete_thread_rows(
        latest_versioned_db(codex_home, "logs_"),
        session_id,
        &[("logs", "DELETE FROM logs WHERE thread_id = ?1")],
    )?;
    purge_thread_catalogs(codex_home, session_id)
}
