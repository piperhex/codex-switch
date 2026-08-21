#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DirectConversationSyncResult {
    conversations_updated: usize,
    rollout_files_updated: usize,
}

pub(crate) fn sync_conversation_metadata_if_present(
    codex_home: &Path,
) -> Result<DirectConversationSyncResult, String> {
    sync_conversation_metadata_if_present_with_progress(codex_home, &mut |_, _| {})
}

pub(crate) fn sync_conversation_metadata_if_present_with_progress(
    codex_home: &Path,
    progress: &mut dyn FnMut(usize, usize),
) -> Result<DirectConversationSyncResult, String> {
    if !has_codex_state_database(codex_home)? {
        return Ok(DirectConversationSyncResult {
            conversations_updated: 0,
            rollout_files_updated: 0,
        });
    }
    replace_conversation_provider_with_progress(
        codex_home,
        OFFICIAL_CONVERSATION_PROVIDER,
        LOCAL_PROXY_CONVERSATION_PROVIDER,
        progress,
    )
}

#[tauri::command]
pub(crate) async fn restore_non_proxy_conversations<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
) -> Result<DirectConversationSyncResult, String> {
    tauri::async_runtime::spawn_blocking(move || restore_non_proxy_conversations_blocking(app))
        .await
        .map_err(|error| format!("恢复非代理模式对话任务失败：{error}"))?
}

fn restore_non_proxy_conversations_blocking<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<DirectConversationSyncResult, String> {
    if crate::local_proxy::is_running() {
        return Err("请先停止本地代理，再恢复非代理模式对话".to_string());
    }

    let _switch_guard = account_switch_lock()
        .lock()
        .map_err(|_| "Account switch lock is poisoned".to_string())?;
    let paths = resolve_paths(&app)?;
    let client_was_running = chatgpt_or_codex_is_running()?;
    let launch_target = client_was_running
        .then(|| refresh_and_get_chatgpt_launch_target(&app))
        .flatten();
    if client_was_running {
        stop_chatgpt_processes()?;
        wait_for_chatgpt_processes_to_exit(Duration::from_secs(10))?;
    }

    let restore_result = restore_conversation_metadata_if_present(&paths.codex_home);
    let restart_result = if client_was_running {
        crate::codex_runtime::restart_managed_session().and_then(|restarted| {
            if restarted {
                Ok(())
            } else {
                start_chatgpt(launch_target.as_ref())
            }
        })
    } else {
        Ok(())
    };

    match (restore_result, restart_result) {
        (Ok(result), Ok(())) => Ok(result),
        (Err(restore_error), Ok(())) => Err(restore_error),
        (Ok(_), Err(restart_error)) => Err(format!(
            "非代理模式对话已恢复，但重新启动 ChatGPT/Codex 失败：{restart_error}。请手动启动 ChatGPT 或 Codex。"
        )),
        (Err(restore_error), Err(restart_error)) => Err(format!(
            "恢复非代理模式对话失败：{restore_error}；重新启动 ChatGPT/Codex 也失败：{restart_error}"
        )),
    }
}

pub(crate) fn restore_conversation_metadata_if_present(
    codex_home: &Path,
) -> Result<DirectConversationSyncResult, String> {
    restore_conversation_metadata_if_present_with_progress(codex_home, &mut |_, _| {})
}

pub(crate) fn restore_conversation_metadata_if_present_with_progress(
    codex_home: &Path,
    progress: &mut dyn FnMut(usize, usize),
) -> Result<DirectConversationSyncResult, String> {
    if !has_codex_state_database(codex_home)? {
        return Ok(DirectConversationSyncResult {
            conversations_updated: 0,
            rollout_files_updated: 0,
        });
    }
    replace_conversation_provider_with_progress(
        codex_home,
        LOCAL_PROXY_CONVERSATION_PROVIDER,
        OFFICIAL_CONVERSATION_PROVIDER,
        progress,
    )
}

fn has_codex_state_database(codex_home: &Path) -> Result<bool, String> {
    let entries = match fs::read_dir(codex_home) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => {
            return Err(format!(
                "无法读取 Codex Home {}：{error}",
                codex_home.display()
            ))
        }
    };
    for entry in entries {
        let entry = entry.map_err(|error| format!("读取 Codex Home 目录项失败：{error}"))?;
        let Some(file_name) = entry.file_name().to_str().map(str::to_string) else {
            continue;
        };
        if file_name
            .strip_prefix("state_")
            .and_then(|value| value.strip_suffix(".sqlite"))
            .and_then(|value| value.parse::<u64>().ok())
            .is_some()
        {
            return Ok(true);
        }
    }
    Ok(false)
}

fn replace_conversation_provider_with_progress(
    codex_home: &Path,
    source_provider: &str,
    target_provider: &str,
    progress: &mut dyn FnMut(usize, usize),
) -> Result<DirectConversationSyncResult, String> {
    let state_database = latest_codex_state_database(codex_home)?;
    let mut connection = open_conversation_database(&state_database)?;
    if !sqlite_table_has_column(&connection, "threads", "model_provider")? {
        return Err(format!(
            "{} 中没有可识别的 Codex 对话表",
            state_database.display()
        ));
    }

    let conversation_rows =
        conversation_rollouts_for_provider(&connection, &state_database, source_provider)?;
    let conversation_ids = conversation_rows
        .iter()
        .map(|(id, _)| id.clone())
        .collect::<Vec<_>>();
    let mut unique_rollout_paths = HashSet::new();
    let conversation_rollouts = conversation_rows
        .into_iter()
        .filter_map(|(_, path)| unique_rollout_paths.insert(path.clone()).then_some(path))
        .collect::<Vec<_>>();
    let total_rollouts = conversation_rollouts.len();
    progress(0, total_rollouts);

    // Keep the primary database update uncommitted until every rollout and
    // desktop catalog has been updated. If any file fails, all completed file
    // changes are compensated before the error is returned.
    let transaction = connection
        .transaction()
        .map_err(|error| format!("无法开始更新 {}：{error}", state_database.display()))?;
    let conversations_updated = transaction
        .execute(
            "UPDATE threads SET model_provider = ?1 WHERE model_provider = ?2",
            params![target_provider, source_provider],
        )
        .map_err(|error| format!("更新 {} 失败：{error}", state_database.display()))?;

    let mut rollout_files_updated = 0;
    let mut updated_rollout_paths = Vec::new();
    for (index, rollout_path) in conversation_rollouts.iter().enumerate() {
        match update_rollout_provider(rollout_path, source_provider, target_provider) {
            Ok(true) => {
                rollout_files_updated += 1;
                updated_rollout_paths.push(rollout_path.clone());
            }
            Ok(false) => {}
            Err(error) => {
                let _ = transaction.rollback();
                let rollback_errors = rollback_rollout_providers(
                    &updated_rollout_paths,
                    target_provider,
                    source_provider,
                );
                return Err(conversation_transition_error(error, rollback_errors));
            }
        }
        progress(index + 1, total_rollouts);
    }

    if let Err(error) = update_desktop_thread_catalogs(
        codex_home,
        source_provider,
        target_provider,
        &conversation_ids,
    ) {
        let _ = transaction.rollback();
        let mut rollback_errors =
            rollback_rollout_providers(&updated_rollout_paths, target_provider, source_provider);
        if let Err(rollback_error) = update_desktop_thread_catalogs(
            codex_home,
            target_provider,
            source_provider,
            &conversation_ids,
        ) {
            rollback_errors.push(rollback_error);
        }
        return Err(conversation_transition_error(error, rollback_errors));
    }

    if let Err(error) = transaction.commit() {
        let mut rollback_errors =
            rollback_rollout_providers(&updated_rollout_paths, target_provider, source_provider);
        if let Err(rollback_error) = update_desktop_thread_catalogs(
            codex_home,
            target_provider,
            source_provider,
            &conversation_ids,
        ) {
            rollback_errors.push(rollback_error);
        }
        return Err(conversation_transition_error(
            format!("提交 {} 失败：{error}", state_database.display()),
            rollback_errors,
        ));
    }

    Ok(DirectConversationSyncResult {
        conversations_updated,
        rollout_files_updated,
    })
}

fn rollback_rollout_providers(
    rollout_paths: &[PathBuf],
    source_provider: &str,
    target_provider: &str,
) -> Vec<String> {
    rollout_paths
        .iter()
        .filter_map(|path| {
            update_rollout_provider(path, source_provider, target_provider)
                .err()
                .map(|error| format!("{}：{error}", path.display()))
        })
        .collect()
}

fn conversation_transition_error(error: String, rollback_errors: Vec<String>) -> String {
    if rollback_errors.is_empty() {
        format!("对话记录切换失败，已恢复原状态：{error}")
    } else {
        format!(
            "对话记录切换失败：{error}；自动恢复时仍有 {} 个文件失败，请重试或导出诊断日志",
            rollback_errors.len()
        )
    }
}

fn latest_codex_state_database(codex_home: &Path) -> Result<PathBuf, String> {
    let entries = fs::read_dir(codex_home)
        .map_err(|error| format!("无法读取 Codex Home {}：{error}", codex_home.display()))?;
    let mut candidates = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|error| format!("读取 Codex Home 目录项失败：{error}"))?;
        let Some(file_name) = entry.file_name().to_str().map(str::to_string) else {
            continue;
        };
        let Some(version) = file_name
            .strip_prefix("state_")
            .and_then(|value| value.strip_suffix(".sqlite"))
            .and_then(|value| value.parse::<u64>().ok())
        else {
            continue;
        };
        candidates.push((version, entry.path()));
    }
    candidates
        .into_iter()
        .max_by_key(|(version, _)| *version)
        .map(|(_, path)| path)
        .ok_or_else(|| format!("未在 {} 中找到 Codex 对话数据库", codex_home.display()))
}

fn open_conversation_database(path: &Path) -> Result<Connection, String> {
    let connection = Connection::open(path)
        .map_err(|error| format!("无法打开 Codex 对话数据库 {}：{error}", path.display()))?;
    connection
        .busy_timeout(Duration::from_secs(5))
        .map_err(|error| format!("无法配置 Codex 对话数据库 {}：{error}", path.display()))?;
    Ok(connection)
}

pub(crate) fn conversation_titles_by_id(
    codex_home: &Path,
    conversation_ids: &HashSet<String>,
) -> Result<HashMap<String, String>, String> {
    if conversation_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let state_database = latest_codex_state_database(codex_home)?;
    let connection = open_conversation_database(&state_database)?;
    if !sqlite_table_has_column(&connection, "threads", "title")? {
        return Ok(HashMap::new());
    }

    let mut statement = connection
        .prepare("SELECT title FROM threads WHERE id = ?1")
        .map_err(|error| format!("无法查询 {}：{error}", state_database.display()))?;
    let mut titles = HashMap::new();
    for id in conversation_ids {
        let title = statement
            .query_row(params![id], |row| row.get::<_, String>(0))
            .optional()
            .map_err(|error| {
                format!(
                    "无法读取 {} 中的对话标题：{error}",
                    state_database.display()
                )
            })?;
        if let Some(title) = title.filter(|title| !title.trim().is_empty()) {
            titles.insert(id.clone(), title);
        }
    }
    Ok(titles)
}

fn sqlite_table_has_column(
    connection: &Connection,
    table: &str,
    column: &str,
) -> Result<bool, String> {
    let mut statement = connection
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(|error| format!("无法读取 SQLite 表 {table}：{error}"))?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| format!("无法读取 SQLite 表 {table} 的字段：{error}"))?;
    for item in columns {
        if item.map_err(|error| format!("无法解析 SQLite 表 {table} 的字段：{error}"))? == column
        {
            return Ok(true);
        }
    }
    Ok(false)
}

fn conversation_rollouts_for_provider(
    connection: &Connection,
    database_path: &Path,
    provider: &str,
) -> Result<Vec<(String, PathBuf)>, String> {
    let mut statement = connection
        .prepare("SELECT id, rollout_path FROM threads WHERE model_provider = ?1")
        .map_err(|error| format!("无法查询 {}：{error}", database_path.display()))?;
    let rows = statement
        .query_map(params![provider], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|error| format!("无法读取 {} 中的对话：{error}", database_path.display()))?;
    rows.map(|row| {
        row.map(|(id, path)| (id, PathBuf::from(path)))
            .map_err(|error| format!("无法解析 Codex 对话文件路径：{error}"))
    })
    .collect()
}

fn update_rollout_provider(
    path: &Path,
    source_provider: &str,
    target_provider: &str,
) -> Result<bool, String> {
    if !path.exists() {
        return Err(format!("Codex 对话文件不存在：{}", path.display()));
    }

    let source = fs::File::open(path)
        .map_err(|error| format!("无法打开 Codex 对话文件 {}：{error}", path.display()))?;
    let mut reader = BufReader::new(source);
    let mut first_line = String::new();
    reader
        .read_line(&mut first_line)
        .map_err(|error| format!("无法读取 Codex 对话文件 {}：{error}", path.display()))?;
    if first_line.trim().is_empty() {
        return Err(format!("Codex 对话文件为空：{}", path.display()));
    }

    let mut metadata: Value = serde_json::from_str(first_line.trim_end())
        .map_err(|error| format!("Codex 对话元数据无效 {}：{error}", path.display()))?;
    let Some(provider) = metadata.pointer_mut("/payload/model_provider") else {
        return Err(format!(
            "Codex 对话文件缺少 model_provider：{}",
            path.display()
        ));
    };
    if provider.as_str() != Some(source_provider) {
        return Ok(false);
    }
    *provider = Value::String(target_provider.to_string());

    let temp_path = path.with_extension(format!("codex-switch-sync-{}.tmp", std::process::id()));
    let write_result = (|| -> Result<(), String> {
        let temp = fs::File::create(&temp_path).map_err(|error| {
            format!(
                "无法创建 Codex 对话临时文件 {}：{error}",
                temp_path.display()
            )
        })?;
        let mut writer = BufWriter::new(temp);
        serde_json::to_writer(&mut writer, &metadata)
            .map_err(|error| format!("无法写入 Codex 对话元数据：{error}"))?;
        writer
            .write_all(b"\n")
            .and_then(|_| std::io::copy(&mut reader, &mut writer).map(|_| ()))
            .and_then(|_| writer.flush())
            .map_err(|error| format!("无法写入 Codex 对话文件 {}：{error}", path.display()))?;
        writer
            .get_ref()
            .sync_all()
            .map_err(|error| format!("无法刷新 Codex 对话文件 {}：{error}", path.display()))
    })();

    if let Err(error) = write_result {
        let _ = fs::remove_file(&temp_path);
        return Err(error);
    }
    drop(reader);
    crate::storage::replace_file(&temp_path, path).map_err(|error| {
        let _ = fs::remove_file(&temp_path);
        format!("无法提交 Codex 对话文件 {}：{error}", path.display())
    })?;
    Ok(true)
}

fn update_desktop_thread_catalogs(
    codex_home: &Path,
    source_provider: &str,
    target_provider: &str,
    conversation_ids: &[String],
) -> Result<(), String> {
    if conversation_ids.is_empty() {
        return Ok(());
    }
    let catalog_dir = codex_home.join("sqlite");
    if !catalog_dir.exists() {
        return Ok(());
    }
    let entries = fs::read_dir(&catalog_dir)
        .map_err(|error| format!("无法读取 Codex 对话目录 {}：{error}", catalog_dir.display()))?;
    for entry in entries {
        let entry = entry.map_err(|error| format!("读取 Codex 对话目录项失败：{error}"))?;
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("db") {
            continue;
        }
        let mut connection = open_conversation_database(&path)?;
        if !sqlite_table_has_column(&connection, "local_thread_catalog", "model_provider")? {
            continue;
        }
        let transaction = connection
            .transaction()
            .map_err(|error| format!("无法开始更新 Codex 对话目录 {}：{error}", path.display()))?;
        {
            let mut statement = transaction
                .prepare(
                    "UPDATE local_thread_catalog SET model_provider = ?1 \
                     WHERE model_provider = ?2 AND thread_id = ?3",
                )
                .map_err(|error| {
                    format!("准备更新 Codex 对话目录 {} 失败：{error}", path.display())
                })?;
            for id in conversation_ids {
                statement
                    .execute(params![target_provider, source_provider, id])
                    .map_err(|error| {
                        format!("更新 Codex 对话目录 {} 失败：{error}", path.display())
                    })?;
            }
        }
        transaction
            .commit()
            .map_err(|error| format!("提交 Codex 对话目录 {} 失败：{error}", path.display()))?;
    }
    Ok(())
}
