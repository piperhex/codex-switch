fn selected_snapshots(
    codex_home: &Path,
    ids: &HashSet<String>,
) -> Result<Vec<RolloutSnapshot>, String> {
    let mut seen = HashSet::new();
    Ok(gather_snapshots(codex_home)?
        .into_iter()
        .filter(|item| ids.contains(&item.session_id) && seen.insert(item.session_id.clone()))
        .collect())
}

fn ensure_export_dependencies(snapshots: &[RolloutSnapshot]) -> Result<HashSet<String>, String> {
    let included = snapshots
        .iter()
        .map(|item| item.session_id.clone())
        .collect::<HashSet<_>>();
    for item in snapshots {
        for dependency in [
            item.history_base_thread_id.as_deref(),
            item.parent_thread_id.as_deref(),
        ]
        .into_iter()
        .flatten()
        {
            if !included.contains(dependency) {
                return Err(format!(
                    "会话 {} 依赖会话 {dependency}，请一起选择后再导出",
                    item.session_id
                ));
            }
        }
    }
    Ok(included)
}

pub(crate) fn inspect_codex_thread_export_blocking<R: Runtime>(
    app: tauri::AppHandle<R>,
    session_ids: Vec<String>,
) -> Result<BundlePreview, String> {
    let requested = normalized_ids(session_ids);
    if requested.is_empty() {
        return Err("请至少选择一条会话".to_string());
    }
    let snapshots = selected_snapshots(&resolve_paths(&app)?.codex_home, &requested)?;
    ensure_export_dependencies(&snapshots)?;
    let items = snapshots
        .into_iter()
        .map(|item| BundlePreviewItem {
            session_id: item.session_id,
            title: item.title,
            cwd: item.cwd,
            updated_at: item.updated_at,
            size_bytes: item.size_bytes,
            status: "ready".to_string(),
            reason: None,
        })
        .collect::<Vec<_>>();
    Ok(BundlePreview {
        package_version: BUNDLE_REVISION,
        exported_at: None,
        total_count: requested.len(),
        ready_count: items.len(),
        total_size_bytes: items.iter().map(|item| item.size_bytes).sum(),
        items,
    })
}

pub(crate) fn pack_codex_threads_blocking<R: Runtime>(
    app: tauri::AppHandle<R>,
    session_ids: Vec<String>,
    export_path: String,
) -> Result<BundleResult, String> {
    let requested = normalized_ids(session_ids);
    if requested.is_empty() {
        return Err("请至少选择一条会话".to_string());
    }
    let codex_home = resolve_paths(&app)?.codex_home;
    let snapshots = selected_snapshots(&codex_home, &requested)?;
    let included_ids = ensure_export_dependencies(&snapshots)?;
    let state_db = latest_state_db(&codex_home);
    let destination = PathBuf::from(export_path.trim());
    if destination.as_os_str().is_empty() {
        return Err("请选择导出位置".to_string());
    }
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("无法创建导出目录：{error}"))?;
    }
    let temporary = destination.with_extension(format!("tmp-{}", Uuid::new_v4()));
    let file = File::create(&temporary).map_err(|error| format!("无法创建会话包：{error}"))?;
    let mut archive = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    let mut manifest_items = Vec::new();
    for (index, snapshot) in snapshots.iter().enumerate() {
        let file_entry = format!(
            "files/{:04}-{}/rollout.jsonl",
            index + 1,
            safe_name(&snapshot.session_id)
        );
        archive
            .start_file(&file_entry, options)
            .map_err(|error| error.to_string())?;
        let mut source = File::open(&snapshot.path).map_err(|error| error.to_string())?;
        std::io::copy(&mut source, &mut archive).map_err(|error| error.to_string())?;
        manifest_items.push(PackageItem {
            session_id: snapshot.session_id.clone(),
            title: snapshot.title.clone(),
            cwd: snapshot.cwd.clone(),
            updated_at: snapshot.updated_at,
            relative_rollout_path: snapshot.relative_path.to_string_lossy().replace('\\', "/"),
            file_entry,
            size_bytes: snapshot.size_bytes,
            sha256: sha256(&snapshot.path)?,
            session_index_entry: snapshot.index_value.clone(),
            source_instance: Some(json!({ "id": "__default__", "name": "默认实例" })),
            state_row: snapshot_thread_row(state_db.as_deref(), &snapshot.session_id)?,
            related_state: snapshot_related_state(
                &codex_home,
                &snapshot.session_id,
                &included_ids,
            )?,
        });
    }
    let manifest = PackageManifest {
        kind: BUNDLE_KIND.to_string(),
        package_version: BUNDLE_REVISION,
        exported_at: Utc::now().to_rfc3339(),
        sessions: manifest_items,
    };
    archive
        .start_file("manifest.json", options)
        .map_err(|error| error.to_string())?;
    archive
        .write_all(
            serde_json::to_string_pretty(&manifest)
                .map_err(|error| error.to_string())?
                .as_bytes(),
        )
        .map_err(|error| error.to_string())?;
    archive
        .finish()
        .map_err(|error| error.to_string())?
        .sync_all()
        .map_err(|error| error.to_string())?;
    replace_file(&temporary, &destination).map_err(|error| format!("无法保存会话包：{error}"))?;
    Ok(BundleResult {
        requested_count: requested.len(),
        completed_count: snapshots.len(),
        skipped_count: requested.len().saturating_sub(snapshots.len()),
        path: destination.to_string_lossy().to_string(),
        message: format!("已导出 {} 条会话", snapshots.len()),
    })
}

fn read_package(path: &Path) -> Result<PackageManifest, String> {
    let file = File::open(path).map_err(|error| format!("无法打开会话包：{error}"))?;
    let mut archive = ZipArchive::new(file).map_err(|error| format!("会话包格式无效：{error}"))?;
    let mut manifest_file = archive
        .by_name("manifest.json")
        .map_err(|_| "会话包缺少 manifest.json".to_string())?;
    let mut content = String::new();
    manifest_file
        .read_to_string(&mut content)
        .map_err(|error| error.to_string())?;
    let manifest: PackageManifest =
        serde_json::from_str(&content).map_err(|error| format!("会话包清单无效：{error}"))?;
    if manifest.kind != BUNDLE_KIND || manifest.package_version != BUNDLE_REVISION {
        return Err("不支持此会话包版本".to_string());
    }
    Ok(manifest)
}

pub(crate) fn inspect_codex_thread_import_blocking<R: Runtime>(
    app: tauri::AppHandle<R>,
    import_path: String,
) -> Result<BundlePreview, String> {
    let path = PathBuf::from(import_path.trim());
    let manifest = read_package(&path)?;
    let existing = gather_snapshots(&resolve_paths(&app)?.codex_home)?
        .into_iter()
        .map(|item| item.session_id)
        .collect::<HashSet<_>>();
    let items = manifest
        .sessions
        .iter()
        .map(|item| {
            let duplicate = existing.contains(&item.session_id);
            BundlePreviewItem {
                session_id: item.session_id.clone(),
                title: item.title.clone(),
                cwd: item.cwd.clone(),
                updated_at: item.updated_at,
                size_bytes: item.size_bytes,
                status: if duplicate { "duplicate" } else { "ready" }.to_string(),
                reason: duplicate.then(|| "默认实例已存在同 ID 会话".to_string()),
            }
        })
        .collect::<Vec<_>>();
    Ok(BundlePreview {
        package_version: manifest.package_version,
        exported_at: Some(manifest.exported_at),
        total_count: items.len(),
        ready_count: items.iter().filter(|item| item.status == "ready").count(),
        total_size_bytes: items.iter().map(|item| item.size_bytes).sum(),
        items,
    })
}

fn safe_relative_path(value: &str) -> Option<PathBuf> {
    let normalized = value.replace('\\', "/");
    let bytes = normalized.as_bytes();
    let has_windows_drive_prefix = matches!(
        (bytes.first(), bytes.get(1)),
        (Some(drive), Some(b':')) if drive.is_ascii_alphabetic()
    );
    let path = PathBuf::from(normalized);
    (!path.as_os_str().is_empty()
        && !has_windows_drive_prefix
        && !path.is_absolute()
        && path
            .components()
            .all(|part| matches!(part, std::path::Component::Normal(_))))
    .then_some(path)
}

pub(crate) fn unpack_codex_threads_blocking<R: Runtime>(
    app: tauri::AppHandle<R>,
    import_path: String,
    session_ids: Vec<String>,
) -> Result<BundleResult, String> {
    let requested = normalized_ids(session_ids);
    if requested.is_empty() {
        return Err("请至少选择一条要导入的会话".to_string());
    }
    let path = PathBuf::from(import_path.trim());
    let manifest = read_package(&path)?;
    let codex_home = resolve_paths(&app)?.codex_home;
    let state_db = latest_state_db(&codex_home);
    let mut existing = gather_snapshots(&codex_home)?
        .into_iter()
        .map(|item| item.session_id)
        .collect::<HashSet<_>>();
    let file = File::open(&path).map_err(|error| error.to_string())?;
    let mut archive = ZipArchive::new(file).map_err(|error| error.to_string())?;
    let mut imported = 0usize;
    for item in manifest
        .sessions
        .iter()
        .filter(|item| requested.contains(&item.session_id))
    {
        if existing.contains(&item.session_id) {
            continue;
        }
        let relative = safe_relative_path(&item.relative_rollout_path).unwrap_or_else(|| {
            PathBuf::from("sessions").join(format!("rollout-{}.jsonl", item.session_id))
        });
        let target = codex_home.join(relative);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let mut packaged = archive
            .by_name(&item.file_entry)
            .map_err(|error| format!("会话包文件缺失：{error}"))?;
        let temporary = target.with_extension(format!("tmp-{}", Uuid::new_v4()));
        let mut output = File::create(&temporary).map_err(|error| error.to_string())?;
        std::io::copy(&mut packaged, &mut output).map_err(|error| error.to_string())?;
        output.sync_all().map_err(|error| error.to_string())?;
        if sha256(&temporary)? != item.sha256 {
            let _ = fs::remove_file(&temporary);
            return Err(format!("会话 {} 校验失败", item.session_id));
        }
        replace_file(&temporary, &target).map_err(|error| error.to_string())?;
        if let Err(error) = restore_thread_row(
            state_db.as_deref(),
            item.state_row.as_ref(),
            &target,
            &item.session_id,
        ) {
            let _ = fs::remove_file(&target);
            return Err(error);
        }
        if let Err(error) =
            restore_related_state(&codex_home, &item.related_state, &item.session_id)
        {
            let _ = purge_thread_state(&codex_home, &item.session_id);
            let _ = fs::remove_file(&target);
            return Err(error);
        }
        append_index_entry(&codex_home, &item.session_id, &item.session_index_entry)?;
        existing.insert(item.session_id.clone());
        imported += 1;
    }
    Ok(BundleResult {
        requested_count: requested.len(),
        completed_count: imported,
        skipped_count: requested.len().saturating_sub(imported),
        path: path.to_string_lossy().to_string(),
        message: format!("已导入 {} 条会话", imported),
    })
}
