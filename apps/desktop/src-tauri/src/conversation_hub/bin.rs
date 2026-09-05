pub(crate) fn browse_codex_thread_bin_blocking<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<Vec<BinEntry>, String> {
    let _guard = bin_operation_guard()?;
    let mut grouped = HashMap::<String, BinEntry>::new();
    for item in collect_bin_entries(&app)? {
        let deleted_at = DateTime::parse_from_rfc3339(&item.manifest.deleted_at)
            .ok()
            .map(|value| value.timestamp());
        let size = directory_size(&item.folder);
        let entry = grouped
            .entry(item.manifest.session_id.clone())
            .or_insert(BinEntry {
                session_id: item.manifest.session_id,
                title: item.manifest.title,
                cwd: item.manifest.cwd,
                deleted_at,
                size_bytes: 0,
            });
        entry.size_bytes = entry.size_bytes.saturating_add(size);
        if deleted_at.unwrap_or_default() > entry.deleted_at.unwrap_or_default() {
            entry.deleted_at = deleted_at;
        }
    }
    let mut result = grouped.into_values().collect::<Vec<_>>();
    result.sort_by(|a, b| {
        b.deleted_at
            .unwrap_or_default()
            .cmp(&a.deleted_at.unwrap_or_default())
    });
    Ok(result)
}

fn append_index_entry(codex_home: &Path, session_id: &str, entry: &Value) -> Result<(), String> {
    let mut entries = index_values(codex_home)?;
    entries.insert(session_id.to_string(), entry.clone());
    let mut values = entries.into_values().collect::<Vec<_>>();
    values.sort_by(|a, b| {
        index_timestamp(Some(b))
            .unwrap_or_default()
            .cmp(&index_timestamp(Some(a)).unwrap_or_default())
    });
    let mut output = String::new();
    for value in values {
        output.push_str(&serde_json::to_string(&value).map_err(|error| error.to_string())?);
        output.push('\n');
    }
    write_text_atomic(&codex_home.join(INDEX_NAME), &output)
}

pub(crate) fn recover_codex_threads_blocking<R: Runtime>(
    app: tauri::AppHandle<R>,
    session_ids: Vec<String>,
) -> Result<MutationReport, String> {
    let _guard = bin_operation_guard()?;
    let requested = normalized_ids(session_ids);
    if requested.is_empty() {
        return Err("请至少选择一条待恢复会话".to_string());
    }
    let codex_home = resolve_paths(&app)?.codex_home;
    let mut restored = HashSet::new();
    let mut restored_groups = HashSet::new();
    let mut entries = collect_bin_entries(&app)?;
    entries.sort_by(|a, b| b.manifest.deleted_at.cmp(&a.manifest.deleted_at));
    for item in entries
        .into_iter()
        .filter(|item| requested.contains(&item.manifest.session_id))
    {
        if !bin_belongs_to_home(&item, &codex_home) {
            return Err("请切换到该会话原来的 Codex 目录后再恢复".to_string());
        }
        let group = legacy_bin_group(&item);
        let recovered = if restored_groups.contains(&group) {
            recover_additional_bin_files(&codex_home, &item)?
        } else {
            recover_bin_snapshot(&codex_home, &item)?
        };
        if recovered {
            restored_groups.insert(group);
            restored.insert(item.manifest.session_id);
        }
    }
    Ok(MutationReport {
        requested_count: requested.len(),
        affected_count: restored.len(),
        released_bytes: 0,
        message: format!("已恢复 {} 条会话", restored.len()),
    })
}

fn delete_bin_items<R: Runtime>(
    app: &tauri::AppHandle<R>,
    requested: Option<&HashSet<String>>,
) -> Result<MutationReport, String> {
    let _guard = bin_operation_guard()?;
    let entries = collect_bin_entries(app)?;
    let codex_home = resolve_paths(app)?.codex_home;
    let target_ids = entries
        .iter()
        .filter(|item| requested.is_none_or(|values| values.contains(&item.manifest.session_id)))
        .map(|item| item.manifest.session_id.clone())
        .collect::<HashSet<_>>();
    let live_ids = gather_snapshots(&codex_home)?
        .into_iter()
        .map(|snapshot| snapshot.session_id)
        .collect::<HashSet<_>>();
    let paths = resolve_paths(app)?;
    let mut manager_state = crate::storage::read_state(&paths);
    for id in target_ids.difference(&live_ids) {
        manager_state.conversation_account_ids.remove(id);
        manager_state.observed_conversation_ids.remove(id);
    }
    crate::storage::write_state(&paths, &manager_state)?;
    let mut ids = HashSet::new();
    let mut released = 0u64;
    for item in entries
        .into_iter()
        .filter(|item| requested.is_none_or(|values| values.contains(&item.manifest.session_id)))
    {
        released = released.saturating_add(directory_size(&item.folder));
        fs::remove_dir_all(&item.folder)
            .map_err(|error| format!("无法永久删除会话 {}：{error}", item.manifest.session_id))?;
        ids.insert(item.manifest.session_id);
    }
    Ok(MutationReport {
        requested_count: requested.map(HashSet::len).unwrap_or(ids.len()),
        affected_count: ids.len(),
        released_bytes: released,
        message: format!("已永久删除 {} 条会话", ids.len()),
    })
}

pub(crate) fn purge_codex_threads_blocking<R: Runtime>(
    app: tauri::AppHandle<R>,
    session_ids: Vec<String>,
) -> Result<MutationReport, String> {
    let requested = normalized_ids(session_ids);
    if requested.is_empty() {
        return Err("请至少选择一条要永久删除的会话".to_string());
    }
    delete_bin_items(&app, Some(&requested))
}

pub(crate) fn empty_codex_thread_bin_blocking<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<MutationReport, String> {
    delete_bin_items(&app, None)
}

fn sha256(path: &Path) -> Result<String, String> {
    let mut file = File::open(path).map_err(|error| error.to_string())?;
    let mut digest = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let count = file.read(&mut buffer).map_err(|error| error.to_string())?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    Ok(format!("{:x}", digest.finalize()))
}
