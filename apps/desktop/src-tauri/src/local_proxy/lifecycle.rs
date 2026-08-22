pub(crate) fn restore_local_proxy_if_enabled<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<bool, String> {
    let paths = resolve_paths(app)?;
    if !read_state(&paths).local_proxy_enabled {
        return Ok(false);
    }

    let started = match start_server(app.clone()) {
        Ok(started) => started,
        Err(error) => {
            let _ = set_local_proxy_enabled(&paths, false);
            return Err(error);
        }
    };
    let write_codex = crate::claude_code::should_write_codex_for_app(app)?;
    let config_result = if write_codex {
        providers::apply_local_proxy_config_for_state(app)
    } else {
        Ok(())
    };
    if let Err(error) = config_result {
        if started {
            stop_server();
        }
        let _ = set_local_proxy_enabled(&paths, false);
        return Err(error);
    }
    Ok(true)
}

#[tauri::command]
pub(crate) async fn start_local_proxy<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
) -> Result<LocalProxyStatus, String> {
    tauri::async_runtime::spawn_blocking(move || start_local_proxy_blocking(app))
        .await
        .map_err(|error| format!("Local proxy start task failed: {error}"))?
}

fn start_local_proxy_blocking<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<LocalProxyStatus, String> {
    let paths = resolve_paths(&app)?;
    let write_codex = crate::claude_code::should_write_codex_for_app(&app)?;
    // Validate the selected official credential before interrupting a running client.
    // The local proxy supports both OAuth and Agent Identity authentication.
    providers::ensure_local_proxy_compatible_for_state(&paths)?;
    emit_start_progress(&app, "preparingClient", 5, None, None);
    // Only interrupt and relaunch a client that is actually running. When no
    // client is open, proxy mode can be enabled by updating its configuration
    // directly, without treating the absence of a process as a stop failure.
    let client_was_running = write_codex && crate::commands::chatgpt_or_codex_is_running()?;
    let launch_target = client_was_running
        .then(|| crate::commands::refresh_and_get_chatgpt_launch_target(&app))
        .flatten();
    if client_was_running {
        // Preserve the path of a running client before ending all ChatGPT/Codex
        // processes. This keeps custom installations usable after proxy mode starts.
        crate::commands::stop_chatgpt_processes()?;
        crate::commands::wait_for_chatgpt_processes_to_exit(std::time::Duration::from_secs(10))?;
    }

    emit_start_progress(&app, "startingProxy", 18, None, None);
    let started = start_server(app.clone())?;
    let config_result = if write_codex {
        providers::apply_local_proxy_config_for_state(&app)
    } else {
        Ok(())
    };
    if let Err(error) = config_result {
        if started {
            stop_server();
        }
        return Err(error);
    }
    set_local_proxy_enabled(&paths, true)?;
    app.emit("providers-changed", ())
        .map_err(|error| error.to_string())?;
    crate::system_tray::refresh_menu(&app);
    let proxy_status = status(&app);
    // Update direct-history metadata while the desktop client is completely
    // stopped, then only launch it once the old conversations are ready for
    // local-proxy mode.
    emit_start_progress(&app, "syncingConversations", 38, Some(0), None);
    let sync_result = if write_codex {
        crate::commands::sync_conversation_metadata_if_present_with_progress(
            &paths.codex_home,
            &mut |processed, total| {
                let percent = processed
                    .saturating_mul(50)
                    .checked_div(total)
                    .map(|progress| 38 + progress.min(50) as u8)
                    .unwrap_or(88);
                emit_start_progress(
                    &app,
                    "syncingConversations",
                    percent,
                    Some(processed),
                    Some(total),
                );
            },
        )
        .map(|_| ())
    } else {
        Ok(())
    };
    let start_result = if client_was_running {
        emit_start_progress(&app, "restartingClient", 92, None, None);
        crate::commands::restart_chatgpt_from_target(&app, launch_target.as_ref())
    } else {
        Ok(())
    };
    match (sync_result, start_result) {
        (Ok(_), Ok(())) => {
            emit_start_progress(&app, "complete", 100, None, None);
            Ok(proxy_status)
        }
        (Err(sync_error), Ok(())) => {
            emit_start_progress(&app, "failed", 88, None, None);
            Err(format!(
                "Local proxy was started, but conversation history could not be synchronized: {sync_error}"
            ))
        }
        (Ok(_), Err(start_error)) => {
            emit_start_progress(&app, "complete", 100, None, None);
            Err(format!(
                "Local proxy was started and conversation history was synchronized, but ChatGPT/Codex could not be restarted ({start_error}). Please start ChatGPT or Codex manually."
            ))
        }
        (Err(sync_error), Err(start_error)) => {
            emit_start_progress(&app, "failed", 92, None, None);
            Err(format!(
                "Local proxy was started, but conversation history could not be synchronized ({sync_error}) and ChatGPT/Codex could not be restarted ({start_error}). Please start ChatGPT or Codex manually."
            ))
        }
    }
}

#[tauri::command]
pub(crate) async fn stop_local_proxy<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
) -> Result<LocalProxyStatus, String> {
    tauri::async_runtime::spawn_blocking(move || stop_local_proxy_blocking(app))
        .await
        .map_err(|error| format!("Local proxy stop task failed: {error}"))?
}

fn stop_local_proxy_blocking<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<LocalProxyStatus, String> {
    let _switch_guard = crate::commands::account_switch_lock()
        .lock()
        .map_err(|_| "Account switch lock is poisoned".to_string())?;
    let paths = resolve_paths(&app)?;
    let write_codex = crate::claude_code::should_write_codex_for_app(&app)?;
    let original_state = read_state(&paths);
    let selected_account_id = original_state.active_account_id.clone();

    // Validate the selected credential before interrupting the client. The managed
    // copy is loaded again after shutdown so auth.json receives the latest tokens.
    if write_codex {
        if let Some(account_id) = selected_account_id.as_deref() {
            let auth = crate::commands::load_validated_managed_auth(&paths, account_id)?;
            ensure_proxy_can_stop_with_auth(&auth)?;
        }
    }

    let client_was_running = write_codex && crate::commands::chatgpt_or_codex_is_running()?;
    let launch_target = client_was_running
        .then(|| crate::commands::refresh_and_get_chatgpt_launch_target(&app))
        .flatten();
    emit_stop_progress(&app, "stoppingClient", 5, None, None);
    if client_was_running {
        crate::commands::stop_chatgpt_processes()?;
        crate::commands::wait_for_chatgpt_processes_to_exit(Duration::from_secs(10))?;
    }

    stop_server();
    emit_stop_progress(&app, "restoringConversations", 12, Some(0), None);
    let conversation_restore_result = if write_codex {
        crate::commands::restore_conversation_metadata_if_present_with_progress(
            &paths.codex_home,
            &mut |processed, total| {
                let percent = processed
                    .saturating_mul(76)
                    .checked_div(total)
                    .map(|progress| 12 + progress.min(76) as u8)
                    .unwrap_or(88);
                emit_stop_progress(
                    &app,
                    "restoringConversations",
                    percent,
                    Some(processed),
                    Some(total),
                );
            },
        )
        .map(|_| ())
    } else {
        Ok(())
    };
    if let Err(restore_error) = conversation_restore_result {
        let recovery_errors = recover_proxy_after_failed_stop(&app, &paths, ProxyRecoveryOptions {
            original_state: &original_state,
            client_was_running,
            launch_target: launch_target.as_ref(),
            restore_proxy_conversations: false,
        });
        emit_stop_progress(&app, "failed", 88, None, None);
        return Err(stop_cancelled_error(restore_error, recovery_errors));
    }

    emit_stop_progress(&app, "restoringConfiguration", 90, None, None);
    let commit_result = (|| -> Result<(), String> {
        if write_codex {
            if let Some(account_id) = selected_account_id.as_deref() {
                crate::commands::write_managed_auth_to_current(&paths, account_id)?;
            }
            providers::restore_default_official_config(&paths)?;
        }
        let state = stopped_proxy_state(read_state(&paths));
        write_state(&paths, &state)
    })();
    if let Err(commit_error) = commit_result {
        let recovery_errors = recover_proxy_after_failed_stop(&app, &paths, ProxyRecoveryOptions {
            original_state: &original_state,
            client_was_running,
            launch_target: launch_target.as_ref(),
            restore_proxy_conversations: true,
        });
        emit_stop_progress(&app, "failed", 90, None, None);
        return Err(stop_cancelled_error(commit_error, recovery_errors));
    }

    let _ = app.emit("providers-changed", ());
    crate::system_tray::refresh_menu(&app);
    let proxy_status = status(&app);
    if !client_was_running {
        emit_stop_progress(&app, "complete", 100, None, None);
        return Ok(proxy_status);
    }

    emit_stop_progress(&app, "restartingClient", 95, None, None);
    let restart_result = crate::commands::restart_chatgpt_from_target(&app, launch_target.as_ref());
    match restart_result {
        Ok(()) => {
            emit_stop_progress(&app, "complete", 100, None, None);
            Ok(proxy_status)
        }
        Err(restart_error) => {
            emit_stop_progress(&app, "complete", 100, None, None);
            Err(format!(
                "Local proxy was stopped, the selected auth.json and non-proxy conversations were restored, but ChatGPT/Codex could not be restarted ({restart_error}). Please start ChatGPT or Codex manually."
            ))
        }
    }
}

struct ProxyRecoveryOptions<'a> {
    original_state: &'a ManagerStateFile,
    client_was_running: bool,
    launch_target: Option<&'a crate::commands::ChatGptLaunchTarget>,
    restore_proxy_conversations: bool,
}

fn recover_proxy_after_failed_stop<R: Runtime>(
    app: &tauri::AppHandle<R>,
    paths: &Paths,
    options: ProxyRecoveryOptions<'_>,
) -> Vec<String> {
    let mut errors = Vec::new();
    let write_codex = match crate::claude_code::should_write_codex_for_app(app) {
        Ok(enabled) => enabled,
        Err(error) => {
            errors.push(format!("write target lookup failed: {error}"));
            false
        }
    };
    if options.restore_proxy_conversations && write_codex {
        if let Err(error) =
            crate::commands::sync_conversation_metadata_if_present(&paths.codex_home)
        {
            errors.push(format!("conversation rollback failed: {error}"));
        }
    }
    if let Err(error) = write_state(paths, options.original_state) {
        errors.push(format!("state rollback failed: {error}"));
    }
    if let Err(error) = start_server(app.clone()) {
        errors.push(format!("proxy restart failed: {error}"));
    } else if write_codex {
        if let Err(error) = providers::apply_local_proxy_config_for_state(app) {
            errors.push(format!("proxy configuration rollback failed: {error}"));
        }
    }
    if options.client_was_running {
        let restart_result = crate::commands::restart_chatgpt_from_target(app, options.launch_target);
        if let Err(error) = restart_result {
            errors.push(format!("client restart failed: {error}"));
        }
    }
    let _ = app.emit("providers-changed", ());
    crate::system_tray::refresh_menu(app);
    errors
}

fn stop_cancelled_error(error: String, recovery_errors: Vec<String>) -> String {
    if recovery_errors.is_empty() {
        format!(
            "Proxy stop was cancelled because conversation history could not be restored safely. Proxy mode remains enabled; you can retry. Details: {error}"
        )
    } else {
        format!(
            "Proxy stop failed and automatic recovery was incomplete ({} recovery errors). Export diagnostic logs before retrying. Details: {error}",
            recovery_errors.len()
        )
    }
}

fn ensure_proxy_can_stop_with_auth(auth: &Value) -> Result<(), String> {
    if is_agent_identity_auth(auth) {
        return Err(
            "当前账号使用 Agent Identity，只能在本地代理模式下使用。请先在代理模式中切换到 OAuth Token 或其他非 Agent Identity 账号，再停止代理"
                .to_string(),
        );
    }
    Ok(())
}

fn stopped_proxy_state(mut state: ManagerStateFile) -> ManagerStateFile {
    state.active_provider_id = None;
    state.active_provider_group = None;
    state.local_proxy_enabled = false;
    state
}
