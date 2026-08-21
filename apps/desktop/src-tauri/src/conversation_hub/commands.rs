#[tauri::command]
pub(crate) async fn browse_codex_threads<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    title_query: Option<String>,
    content_query: Option<String>,
) -> Result<Vec<ThreadEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        browse_codex_threads_blocking(app, title_query, content_query)
    })
    .await
    .map_err(|error| format!("Browse conversations task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn measure_codex_thread_tokens<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    session_ids: Vec<String>,
) -> Result<Vec<ThreadTokenTotals>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        measure_codex_thread_tokens_blocking(app, session_ids)
    })
    .await
    .map_err(|error| format!("Measure conversation tokens task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn discard_codex_threads<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    session_ids: Vec<String>,
) -> Result<MutationReport, String> {
    tauri::async_runtime::spawn_blocking(move || discard_codex_threads_blocking(app, session_ids))
        .await
        .map_err(|error| format!("Discard conversations task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn browse_codex_thread_bin<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
) -> Result<Vec<BinEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || browse_codex_thread_bin_blocking(app))
        .await
        .map_err(|error| format!("Browse conversation bin task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn recover_codex_threads<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    session_ids: Vec<String>,
) -> Result<MutationReport, String> {
    tauri::async_runtime::spawn_blocking(move || recover_codex_threads_blocking(app, session_ids))
        .await
        .map_err(|error| format!("Recover conversations task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn purge_codex_threads<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    session_ids: Vec<String>,
) -> Result<MutationReport, String> {
    tauri::async_runtime::spawn_blocking(move || purge_codex_threads_blocking(app, session_ids))
        .await
        .map_err(|error| format!("Purge conversations task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn empty_codex_thread_bin<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
) -> Result<MutationReport, String> {
    tauri::async_runtime::spawn_blocking(move || empty_codex_thread_bin_blocking(app))
        .await
        .map_err(|error| format!("Empty conversation bin task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn inspect_codex_thread_export<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    session_ids: Vec<String>,
) -> Result<BundlePreview, String> {
    tauri::async_runtime::spawn_blocking(move || {
        inspect_codex_thread_export_blocking(app, session_ids)
    })
    .await
    .map_err(|error| format!("Inspect conversation export task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn pack_codex_threads<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    session_ids: Vec<String>,
    export_path: String,
) -> Result<BundleResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        pack_codex_threads_blocking(app, session_ids, export_path)
    })
    .await
    .map_err(|error| format!("Pack conversations task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn inspect_codex_thread_import<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    import_path: String,
) -> Result<BundlePreview, String> {
    tauri::async_runtime::spawn_blocking(move || {
        inspect_codex_thread_import_blocking(app, import_path)
    })
    .await
    .map_err(|error| format!("Inspect conversation import task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn unpack_codex_threads<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    import_path: String,
    session_ids: Vec<String>,
) -> Result<BundleResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        unpack_codex_threads_blocking(app, import_path, session_ids)
    })
    .await
    .map_err(|error| format!("Unpack conversations task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn reconcile_codex_thread_visibility<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    mode: String,
    session_ids: Option<Vec<String>>,
    dry_run: bool,
) -> Result<VisibilityReport, String> {
    tauri::async_runtime::spawn_blocking(move || {
        reconcile_codex_thread_visibility_blocking(app, mode, session_ids, dry_run)
    })
    .await
    .map_err(|error| format!("Reconcile conversation visibility task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn rebuild_codex_thread_index<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
) -> Result<VisibilityReport, String> {
    tauri::async_runtime::spawn_blocking(move || rebuild_codex_thread_index_blocking(app))
        .await
        .map_err(|error| format!("Rebuild conversation index task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn open_codex_thread_file<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    session_id: String,
    folder_only: bool,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        open_codex_thread_file_blocking(app, session_id, folder_only)
    })
    .await
    .map_err(|error| format!("Open conversation file task failed: {error}"))?
}
