const THREAD_ID_KEYS: [&str; 8] = [
    "id",
    "session_id",
    "sessionId",
    "thread_id",
    "threadId",
    "conversation_id",
    "conversationId",
    "root_thread_id",
];

const THREAD_RELATION_KEYS: [&str; 5] = [
    "parent_thread_id",
    "parentThreadId",
    "history_base_thread_id",
    "historyBaseThreadId",
    "forked_from_id",
];

struct MigrationClientState {
    was_running: bool,
    launch_target: Option<crate::commands::ChatGptLaunchTarget>,
}

fn rewrite_thread_identifiers(value: &mut Value, source_id: &str, target_id: &str) {
    match value {
        Value::Array(values) => values
            .iter_mut()
            .for_each(|value| rewrite_thread_identifiers(value, source_id, target_id)),
        Value::Object(values) => {
            for (key, value) in values.iter_mut() {
                if THREAD_RELATION_KEYS.contains(&key.as_str())
                    && value.as_str() == Some(source_id)
                {
                    *value = Value::Null;
                    continue;
                }
                if THREAD_ID_KEYS.contains(&key.as_str())
                    && value.as_str() == Some(source_id)
                {
                    *value = Value::String(target_id.to_string());
                    continue;
                }
                rewrite_thread_identifiers(value, source_id, target_id);
            }
        }
        _ => {}
    }
}

fn rewritten_rollout(
    path: &Path,
    source_id: &str,
    target_id: &str,
) -> Result<String, String> {
    let mut output = String::new();
    for line in rollout_reader(path)?.lines() {
        let line = line.map_err(|error| format!("无法读取会话文件：{error}"))?;
        if line.trim().is_empty() {
            output.push('\n');
            continue;
        }
        let mut value: Value = serde_json::from_str(line.trim())
            .map_err(|error| format!("会话文件包含无效 JSON：{error}"))?;
        rewrite_thread_identifiers(&mut value, source_id, target_id);
        output.push_str(
            &serde_json::to_string(&value).map_err(|error| format!("序列化会话失败：{error}"))?,
        );
        output.push('\n');
    }
    Ok(output)
}

fn cloned_rollout_path(codex_home: &Path, snapshot: &RolloutSnapshot, target_id: &str) -> PathBuf {
    let parent = snapshot
        .relative_path
        .parent()
        .unwrap_or_else(|| Path::new("sessions"));
    codex_home
        .join(parent)
        .join(format!("rollout-{target_id}.jsonl"))
}

fn mark_index_title_as_migrated(index_entry: &mut Value) {
    let Some(values) = index_entry.as_object_mut() else {
        return;
    };
    for key in ["thread_name", "threadName", "title", "name"] {
        let Some(Value::String(title)) = values.get_mut(key) else {
            continue;
        };
        title.push_str("（迁移）");
        return;
    }
}

fn clone_thread(codex_home: &Path, snapshot: &RolloutSnapshot) -> Result<String, String> {
    let source_id = snapshot.session_id.as_str();
    let target_id = Uuid::new_v4().to_string();
    let target_path = cloned_rollout_path(codex_home, snapshot, &target_id);
    let content = rewritten_rollout(&snapshot.path, source_id, &target_id)?;
    if let Some(parent) = target_path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("无法创建会话目录：{error}"))?;
    }
    write_text_atomic(&target_path, &content)?;

    if let Some(row) = snapshot_thread_row(latest_state_db(codex_home).as_deref(), source_id)? {
        restore_thread_row(
            latest_state_db(codex_home).as_deref(),
            Some(&row),
            &target_path,
            &target_id,
        )?;
    }

    let included = HashSet::from([source_id.to_string()]);
    let mut related = snapshot_related_state(codex_home, source_id, &included)?;
    related.retain(|snapshot| snapshot.table != "thread_spawn_edges");
    restore_related_state(codex_home, &related, &target_id)?;

    let mut index_entry = snapshot.index_value.clone();
    rewrite_thread_identifiers(&mut index_entry, source_id, &target_id);
    mark_index_title_as_migrated(&mut index_entry);
    append_index_entry(codex_home, &target_id, &index_entry)?;
    Ok(target_id)
}

fn prepare_migration_client<R: Runtime>(
    app: &tauri::AppHandle<R>,
    has_eligible_threads: bool,
) -> Result<MigrationClientState, String> {
    let was_running = has_eligible_threads && crate::commands::chatgpt_or_codex_is_running()?;
    let launch_target = was_running
        .then(|| crate::commands::refresh_and_get_chatgpt_launch_target(app))
        .flatten();
    if was_running {
        crate::commands::stop_chatgpt_processes()?;
        crate::commands::wait_for_chatgpt_processes_to_exit(std::time::Duration::from_secs(10))?;
    }
    Ok(MigrationClientState {
        was_running,
        launch_target,
    })
}

fn restart_migration_client(client: &MigrationClientState) -> Result<(), String> {
    if !client.was_running {
        return Ok(());
    }
    if crate::codex_runtime::restart_managed_session()? {
        return Ok(());
    }
    crate::commands::start_chatgpt(client.launch_target.as_ref())
}

fn migrate_selected_threads(
    paths: &crate::storage::Paths,
    state: &mut crate::models::ManagerStateFile,
    selected: Vec<RolloutSnapshot>,
    target_account_id: &str,
) -> Result<(usize, usize), String> {
    let mut migrated_count = 0;
    let mut skipped_count = 0;
    for snapshot in selected {
        let owner = state.conversation_account_ids.get(&snapshot.session_id);
        if owner.is_some_and(|owner| owner == target_account_id) {
            skipped_count += 1;
            continue;
        }
        let new_id = clone_thread(&paths.codex_home, &snapshot)?;
        state
            .conversation_account_ids
            .insert(new_id.clone(), target_account_id.to_string());
        state.observed_conversation_ids.insert(new_id);
        migrated_count += 1;
    }
    crate::storage::write_state(paths, state)?;
    Ok((migrated_count, skipped_count))
}

pub(crate) fn migrate_codex_threads_blocking<R: Runtime>(
    app: tauri::AppHandle<R>,
    session_ids: Vec<String>,
) -> Result<MigrationReport, String> {
    let requested = normalized_ids(session_ids);
    if requested.is_empty() {
        return Err("请至少选择一条要迁移的会话".to_string());
    }
    let _switch_guard = crate::commands::account_switch_lock()
        .lock()
        .map_err(|_| "账户切换锁不可用".to_string())?;
    let paths = resolve_paths(&app)?;
    let snapshots = gather_snapshots(&paths.codex_home)?;
    let mut state = sync_thread_ownership(&paths, &snapshots)?;
    let target_account_id = state
        .active_account_id
        .clone()
        .ok_or_else(|| "请先启用一个当前账户".to_string())?;
    let selected = snapshots
        .into_iter()
        .filter(|snapshot| requested.contains(&snapshot.session_id))
        .collect::<Vec<_>>();
    let has_eligible_threads = selected.iter().any(|snapshot| {
        state
            .conversation_account_ids
            .get(&snapshot.session_id)
            .is_none_or(|account_id| account_id != &target_account_id)
    });
    let client = prepare_migration_client(&app, has_eligible_threads)?;
    let migration = migrate_selected_threads(&paths, &mut state, selected, &target_account_id);
    let restart = restart_migration_client(&client);
    let (migrated_count, skipped_count) = match (migration, restart) {
        (Ok(result), Ok(())) => result,
        (Ok(_), Err(error)) => return Err(format!("会话迁移完成，但无法重新启动 ChatGPT/Codex：{error}")),
        (Err(error), Ok(())) => return Err(error),
        (Err(error), Err(restart_error)) => {
            return Err(format!("会话迁移失败：{error}；重新启动 ChatGPT/Codex 也失败：{restart_error}"));
        }
    };

    Ok(MigrationReport {
        requested_count: requested.len(),
        migrated_count,
        skipped_count,
        message: format!("已将 {migrated_count} 条会话复制到当前账户，跳过 {skipped_count} 条"),
    })
}
