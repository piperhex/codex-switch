use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodexConfigRepairResult {
    repaired_config_count: usize,
    proxy_config_reapplied: bool,
}

#[tauri::command]
pub(crate) async fn repair_codex_config<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
) -> Result<CodexConfigRepairResult, String> {
    let result = tauri::async_runtime::spawn_blocking(move || repair_codex_config_blocking(&app))
        .await
        .map_err(|error| format!("Codex config repair task failed: {error}"))?;
    result.map_err(|error| {
        eprintln!("Codex config repair failed: {error}");
        "Codex configuration could not be repaired. Check file permissions and try again."
            .to_string()
    })
}

fn repair_codex_config_blocking<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<CodexConfigRepairResult, String> {
    let targets = crate::storage::resolve_enabled_paths(app)?;
    let proxy_running = crate::local_proxy::is_running();
    let official_config = codex_config::default_official(
        DEFAULT_OFFICIAL_MODEL,
        DEFAULT_OFFICIAL_REASONING_EFFORT,
    );

    for target in &targets {
        replace_codex_config(target, &official_config, proxy_running)?;
    }
    if proxy_running {
        apply_local_proxy_config_for_state(app)?;
    }

    Ok(CodexConfigRepairResult {
        repaired_config_count: targets.len(),
        proxy_config_reapplied: proxy_running,
    })
}

fn replace_codex_config(
    paths: &Paths,
    official_config: &str,
    prepare_proxy_backup: bool,
) -> Result<(), String> {
    write_text_atomic(&paths.current_config, official_config)?;
    if prepare_proxy_backup {
        return write_text_atomic(&paths.config_backup, official_config);
    }
    if paths.config_backup.exists() {
        fs::remove_file(&paths.config_backup)
            .map_err(|error| format!("Failed to clear Codex config backup: {error}"))?;
    }
    Ok(())
}
