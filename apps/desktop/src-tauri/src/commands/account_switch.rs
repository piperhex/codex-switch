#[tauri::command]
pub(crate) async fn switch_account<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    id: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || switch_account_blocking(app, id))
        .await
        .map_err(|error| format!("Account switch task failed: {error}"))?
}

/// Blocking account switch that must run off the UI thread. The switch spawns
/// PowerShell subprocesses and performs file I/O, so it is invoked through
/// `switch_account` on the desktop and directly from proxy request threads.
pub(crate) fn switch_account_blocking<R: Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
) -> Result<(), String> {
    let _switch_guard = account_switch_lock()
        .lock()
        .map_err(|_| "Account switch lock is poisoned".to_string())?;
    refresh_local_codex_path(&app);
    switch_account_unlocked(&app, &id)
}

/// Switch an official account without ever exposing a running ChatGPT/Codex
/// process to the replacement credential.  The local proxy owns the active
/// credential while it is running, so proxy switches intentionally remain
/// hot and do not restart ChatGPT.
#[tauri::command]
pub(crate) async fn switch_account_and_restart_chatgpt<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    id: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        switch_account_and_restart_chatgpt_blocking(app, id)
    })
    .await
    .map_err(|error| format!("Account switch task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn deactivate_account_and_restart_chatgpt<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        deactivate_account_and_restart_chatgpt_blocking(app)
    })
    .await
    .map_err(|error| format!("Account deactivation task failed: {error}"))?
}

fn deactivate_account_and_restart_chatgpt_blocking<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<(), String> {
    let _switch_guard = account_switch_lock()
        .lock()
        .map_err(|_| "Account switch lock is poisoned".to_string())?;
    refresh_local_codex_path(&app);

    if !crate::claude_code::should_write_codex_for_app(&app)? {
        return deactivate_account_unlocked(&app, crate::local_proxy::is_running()).map(|_| ());
    }

    let proxy_running = crate::local_proxy::is_running();
    let client_was_running = !proxy_running && chatgpt_or_codex_is_running()?;
    let launch_target = client_was_running
        .then(|| refresh_and_get_chatgpt_launch_target(&app))
        .flatten();
    if client_was_running {
        stop_chatgpt_processes()?;
        wait_for_chatgpt_processes_to_exit(Duration::from_secs(10))?;
    }

    let deactivate_result = deactivate_account_unlocked(&app, proxy_running);
    if !client_was_running {
        return deactivate_result.map(|_| ());
    }

    let restart_result = crate::codex_runtime::restart_managed_session().and_then(|restarted| {
        if restarted {
            Ok(())
        } else {
            start_chatgpt(launch_target.as_ref())
        }
    });
    match (deactivate_result, restart_result) {
        (Ok(_), Ok(())) => Ok(()),
        (Err(error), Ok(())) => Err(error),
        (Ok(_), Err(error)) => Err(format!(
            concat!(
                "Official account was deactivated, but ChatGPT/Codex could not be restarted ",
                "({error}). Please start ChatGPT or Codex manually."
            ),
            error = error
        )),
        (Err(deactivate_error), Err(restart_error)) => Err(format!(
            concat!(
                "Official account could not be deactivated ({deactivate_error}), ",
                "and ChatGPT/Codex could not be restarted ({restart_error})."
            ),
            deactivate_error = deactivate_error,
            restart_error = restart_error
        )),
    }
}

fn deactivate_account_unlocked<R: Runtime>(
    app: &tauri::AppHandle<R>,
    proxy_running: bool,
) -> Result<Option<String>, String> {
    let paths = resolve_paths(app)?;
    let original_state = read_state(&paths);
    let Some(account_id) = original_state.active_account_id.clone() else {
        return Ok(None);
    };
    let mut state = original_state.clone();
    state.active_account_id = None;
    state.concurrent_account_routing_enabled = false;
    write_state(&paths, &state)?;

    let write_codex = crate::claude_code::should_write_codex_for_app(app)?;
    let auth_result = if !write_codex {
        Ok(())
    } else if proxy_running {
        crate::providers::sync_local_proxy_openai_auth(&paths)
    } else {
        match fs::remove_file(&paths.current_auth) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(format!("Failed to remove current auth.json: {error}")),
        }
    };
    if let Err(error) = auth_result {
        let _ = write_state(&paths, &original_state);
        return Err(error);
    }

    touch_account_field(&paths, &account_id, AccountSyncField::Active)?;
    app.emit("accounts-changed", ())
        .map_err(|error| error.to_string())?;
    app.emit("providers-changed", ())
        .map_err(|error| error.to_string())?;
    if proxy_running && write_codex {
        crate::providers::refresh_official_codex_models();
    }
    crate::claude_code::sync_after_switch(app)?;
    crate::system_tray::refresh_menu(app);
    Ok(Some(account_id))
}

pub(crate) fn switch_account_and_restart_chatgpt_blocking<R: Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
) -> Result<(), String> {
    let _switch_guard = account_switch_lock()
        .lock()
        .map_err(|_| "Account switch lock is poisoned".to_string())?;

    // Refresh the launch hint for every account switch, including hot proxy
    // switches where no restart is needed.
    refresh_local_codex_path(&app);
    if !crate::claude_code::should_write_codex_for_app(&app)? {
        return switch_account_unlocked(&app, &id);
    }
    if crate::local_proxy::is_running() {
        return switch_account_unlocked(&app, &id);
    }

    // Validate the target before stopping ChatGPT so a malformed managed
    // credential cannot leave the user with a closed application.
    let paths = resolve_paths(&app)?;
    load_validated_managed_auth(&paths, &id)?;

    let launch_target = refresh_and_get_chatgpt_launch_target(&app);
    if chatgpt_or_codex_is_running()? {
        stop_chatgpt_processes()?;
        wait_for_chatgpt_processes_to_exit(Duration::from_secs(10))?;
    }

    // When no client is running, write the replacement credential immediately.
    // When one is running, the preceding shutdown gives the same guarantee.
    switch_account_unlocked(&app, &id)?;
    if crate::codex_runtime::restart_managed_session()? {
        return Ok(());
    }

    start_chatgpt(launch_target.as_ref()).map_err(|error| {
        format!(
            "账户已切换，但无法自动启动 ChatGPT/Codex（{error}）。请手动启动 ChatGPT 或 Codex。"
        )
    })
}

fn switch_account_unlocked<R: Runtime>(app: &tauri::AppHandle<R>, id: &str) -> Result<(), String> {
    let proxy_running = crate::local_proxy::is_running();
    let paths = resolve_paths(app)?;
    let selected = load_validated_managed_auth(&paths, id)?;
    ensure_account_switch_allowed(&selected, proxy_running)?;
    let original_state = read_state(&paths);
    let mut state = original_state.clone();
    state.active_provider_id = None;
    state.active_provider_group = None;
    state.active_account_id = Some(id.to_string());
    state.concurrent_account_routing_enabled = false;

    let write_codex = crate::claude_code::should_write_codex_for_app(app)?;
    if !write_codex {
        write_state(&paths, &state)?;
    } else if proxy_running {
        // Publish the official route before changing config.toml. Codex watches that
        // file and may reconnect immediately; writing the config first would let the
        // reconnect race through the previously selected third-party Provider.
        write_state(&paths, &state)?;
        if let Err(error) = crate::providers::write_official_local_proxy_config(&paths) {
            let _ = write_state(&paths, &original_state);
            return Err(error);
        }
        if let Err(error) = crate::providers::sync_local_proxy_openai_auth(&paths) {
            let _ = write_state(&paths, &original_state);
            return Err(error);
        }
    } else {
        // The local proxy reads the selected managed credential.  Avoid modifying the
        // authentication file watched by the already-running Codex application.
        write_json_atomic(&paths.current_auth, &selected)?;
        // Always remove a stale managed Provider block, even if an older or partially
        // completed switch left active_provider_id out of sync with config.toml.
        crate::providers::restore_official_config(&paths)?;
        write_state(&paths, &state)?;
    }
    touch_account_field(&paths, id, AccountSyncField::Active)?;
    app.emit("accounts-changed", ())
        .map_err(|error| error.to_string())?;
    app.emit("providers-changed", ())
        .map_err(|error| error.to_string())?;
    if proxy_running && write_codex {
        crate::providers::refresh_official_codex_models();
    }
    crate::claude_code::sync_after_switch(app)?;
    crate::system_tray::refresh_menu(app);
    Ok(())
}

fn ensure_account_switch_allowed(auth: &Value, proxy_running: bool) -> Result<(), String> {
    if !proxy_running && is_agent_identity_auth(auth) {
        return Err(
            "Agent Identity 账号只能在本地代理模式下切换。请先启动本地代理，再切换到该账号"
                .to_string(),
        );
    }
    Ok(())
}

pub(crate) fn load_validated_managed_auth(paths: &Paths, id: &str) -> Result<Value, String> {
    let mut auth = read_json(&managed_auth_path(paths, id))?;
    if canonicalize_chatgpt_auth(&mut auth)? {
        write_managed_auth_if_changed(paths, id, &auth)?;
    }
    validate_auth(&auth)?;
    Ok(auth)
}

pub(crate) fn write_managed_auth_to_current(paths: &Paths, id: &str) -> Result<(), String> {
    let auth = load_validated_managed_auth(paths, id)?;
    write_json_atomic(&paths.current_auth, &auth)
}

#[tauri::command]
pub(crate) fn set_account_auto_switch_enabled<R: Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
    enabled: bool,
) -> Result<(), String> {
    let paths = resolve_paths(&app)?;
    if !managed_auth_path(&paths, &id).exists() {
        return Err("Account does not exist".to_string());
    }
    set_account_auto_switch_enabled_for_paths(&paths, &id, enabled)?;
    app.emit("accounts-changed", ())
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub(crate) fn set_auto_disable_status_codes<R: Runtime>(
    app: tauri::AppHandle<R>,
    mut status_codes: Vec<u16>,
) -> Result<AppSettings, String> {
    if status_codes
        .iter()
        .any(|status| !(100..=599).contains(status))
    {
        return Err("automatic disable status codes must be between 100 and 599".to_string());
    }
    status_codes.sort_unstable();
    status_codes.dedup();

    let mut settings = read_app_settings(&app)?;
    settings.auto_disable_status_codes = status_codes;
    write_app_settings(&app, &settings)?;
    Ok(settings)
}

#[tauri::command]
pub(crate) fn set_account_auto_switch_priority<R: Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
    priority: i32,
) -> Result<(), String> {
    let paths = resolve_paths(&app)?;
    if !managed_auth_path(&paths, &id).exists() {
        return Err("Account does not exist".to_string());
    }
    let path = auto_switch_priority_path(&paths, &id);
    if load_auto_switch_priority(&path) != priority || !path.exists() {
        save_auto_switch_priority(&path, priority)?;
        touch_account_field(&paths, &id, AccountSyncField::AutoSwitchPriority)?;
    }
    app.emit("accounts-changed", ())
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn update_disabled_account_ids(state: &mut ManagerStateFile, id: &str, enabled: bool) -> bool {
    let was_disabled = state
        .disabled_account_ids
        .iter()
        .any(|account_id| account_id == id);
    let should_be_disabled = !enabled;
    if enabled {
        state
            .disabled_account_ids
            .retain(|account_id| account_id != id);
    } else if !was_disabled {
        state.disabled_account_ids.push(id.to_string());
        state.disabled_account_ids.sort();
    }
    was_disabled != should_be_disabled
}

fn set_account_auto_switch_enabled_for_paths(
    paths: &Paths,
    id: &str,
    enabled: bool,
) -> Result<bool, String> {
    let _guard = account_auto_switch_state_lock()
        .lock()
        .map_err(|_| "Account auto-switch state lock is poisoned".to_string())?;
    let mut state = read_state(paths);
    let changed = update_disabled_account_ids(&mut state, id, enabled);
    if changed {
        write_state(paths, &state)?;
    }
    Ok(changed)
}
