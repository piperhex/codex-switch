fn start_managed_runtime(
    paths: &RuntimePaths,
    install: &CodexInstall,
    verification_mode: SkinVerificationMode,
) -> Result<(), String> {
    let _launch = RuntimeLaunchGuard::acquire();
    stop_codex(install)?;
    let port = select_port()?;
    let profile = cdp_profile_path()?;
    ensure_directory(&profile)?;
    let arguments = managed_runtime_arguments(port, &profile);
    let mut state = read_session();
    state.session = "active".to_string();
    state.port = Some(port);
    state.codex_executable = Some(install.executable.display().to_string());
    write_session(&state)?;
    launch_codex(install, &arguments)?;
    ensure_monitor(paths.clone());
    wake_monitor();
    wait_for_targets(port, CODEX_RENDERER_START_TIMEOUT)?;
    refresh_models_after_runtime_ready(paths);
    let skin_installed = marker_path()?.is_file();
    let skin_paused = pause_path()?.is_file();
    if skin_verification_required(skin_installed, skin_paused) {
        wake_monitor();
        if wait_for_skin_verification(skin_installed, skin_paused, verification_mode) {
            wait_for_verified(port, DREAM_SKIN_START_VERIFICATION_TIMEOUT)?;
        }
    }
    Ok(())
}

fn runtime_paths_for_app(app: &AppHandle) -> Result<RuntimePaths, String> {
    Ok(RuntimePaths {
        bundled_root: bundled_root(app)?,
        codex_paths: Some(crate::storage::resolve_paths(app)?),
    })
}

fn refresh_models_after_runtime_ready(paths: &RuntimePaths) {
    let Some(codex_paths) = paths.codex_paths.clone() else {
        return;
    };
    let _ = thread::Builder::new()
        .name("codex-model-refresh-after-launch".to_string())
        .spawn(move || {
            thread::sleep(Duration::from_millis(500));
            crate::providers::refresh_codex_models_for_current_target(&codex_paths);
        });
}

fn managed_runtime_arguments(port: u16, profile: &Path) -> Vec<String> {
    vec![
        "--remote-debugging-address=127.0.0.1".to_string(),
        format!("--remote-debugging-port={port}"),
        format!("--user-data-dir={}", profile.display()),
    ]
}

fn skin_verification_required(skin_installed: bool, skin_paused: bool) -> bool {
    skin_installed && !skin_paused
}

fn wait_for_skin_verification(
    skin_installed: bool,
    skin_paused: bool,
    verification_mode: SkinVerificationMode,
) -> bool {
    skin_verification_required(skin_installed, skin_paused)
        && verification_mode == SkinVerificationMode::Required
}

fn restart_managed_runtime(
    paths: &RuntimePaths,
    verification_mode: SkinVerificationMode,
) -> Result<(), String> {
    // The current process is often already gone on a normal restart.  Prefer
    // the executable that originally activated the runtime instead of falling
    // back to whichever Store installation happens to be discoverable.
    let install = find_runtime_launch_install()?;
    let fallback = find_default_codex_install()
        .ok()
        .filter(|fallback| !same_install(&install, fallback));
    match start_managed_runtime(paths, &install, verification_mode) {
        Ok(()) => Ok(()),
        Err(primary_error) if fallback.is_some() => {
            let _ = stop_codex(&install);
            let fallback = fallback.expect("checked above");
            start_managed_runtime(paths, &fallback, verification_mode).map_err(|fallback_error| {
                format!(
                    concat!(
                        "Codex could not start from the running ChatGPT path ({}): {}; ",
                        "fallback path ({}) also failed: {}"
                    ),
                    install.executable.display(),
                    primary_error,
                    fallback.executable.display(),
                    fallback_error,
                )
            })
        }
        Err(error) => Err(error),
    }
}

pub(crate) fn setup_runtime(app: &AppHandle) -> Result<(), String> {
    if marker_path()?.is_file() {
        initialize_store()?;
    }
    if !session_path()?.is_file() {
        write_session(&NativeSessionState::default())?;
    }
    ensure_monitor(runtime_paths_for_app(app)?);
    Ok(())
}

pub(crate) fn restart_runtime_session() -> Result<(), String> {
    let _operation = OPERATION_LOCK
        .lock()
        .map_err(|_| "Codex runtime operation lock is unavailable.".to_string())?;
    let paths = MONITOR
        .get()
        .and_then(|control| {
            control
                .paths
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .clone()
        })
        .ok_or_else(|| "Codex runtime is not initialized.".to_string())?;
    restart_managed_runtime(&paths, SkinVerificationMode::Background)
}

fn install_unlocked(app: &AppHandle, restart_chatgpt: bool) -> Result<(), String> {
    initialize_store()?;
    if restart_chatgpt {
        load_theme(&active_theme_root()?).map_err(|_| {
            "Dream Skin preset resources are still downloading; choose a theme after they are ready."
                .to_string()
        })?;
    }
    write_json(
        &marker_path()?,
        &InstallationMarker {
            schema_version: 1,
            runtime: "rust-native".to_string(),
            version: NATIVE_RUNTIME_VERSION.to_string(),
        },
    )?;
    if !session_path()?.is_file() {
        write_session(&NativeSessionState::default())?;
    }
    let paths = runtime_paths_for_app(app)?;
    if restart_chatgpt {
        restart_managed_runtime(&paths, SkinVerificationMode::Required)
    } else {
        ensure_monitor(paths);
        Ok(())
    }
}

pub(crate) fn install(app: &AppHandle) -> Result<(), String> {
    let _operation = OPERATION_LOCK
        .lock()
        .map_err(|_| "Dream Skin operation lock is unavailable.".to_string())?;
    install_unlocked(app, true)
}

fn ensure_installed(app: &AppHandle) -> Result<RuntimePaths, String> {
    if !marker_path()?.is_file() {
        install_unlocked(app, false)?;
    }
    let paths = runtime_paths_for_app(app)?;
    initialize_store()?;
    ensure_monitor(paths.clone());
    Ok(paths)
}

pub(crate) fn apply_theme(app: &AppHandle, theme_id: &str) -> Result<(), String> {
    if !valid_theme_id(theme_id) {
        return Err("Theme id is invalid.".to_string());
    }
    let _operation = OPERATION_LOCK
        .lock()
        .map_err(|_| "Dream Skin operation lock is unavailable.".to_string())?;
    // A running Dream Skin session watches the active theme payload and
    // reinjects it when its revision changes.  Only the initial installation
    // needs a managed launch to give ChatGPT/Codex its CDP arguments.
    let already_installed = marker_path()?.is_file();
    let paths = ensure_installed(app)?;
    let directory = if BUILT_IN_THEME_IDS.contains(&theme_id) {
        let resource_root = crate::dream_skin_resources::installed_pack_root()?;
        built_in_theme_directory(&resource_root, theme_id)?
    } else {
        saved_theme_directory(theme_id)?
    };
    copy_theme_to_active(&directory)?;
    let _ = fs::remove_file(pause_path()?);
    if already_installed {
        ensure_monitor(paths);
        wake_monitor();
        Ok(())
    } else {
        restart_managed_runtime(&paths, SkinVerificationMode::Required)
    }
}

fn validate_import_options(options: &DreamSkinImportOptions) -> Result<(), String> {
    validate_name(&options.name)?;
    if !matches!(options.appearance.as_str(), "auto" | "light" | "dark") {
        return Err("Theme appearance is invalid.".to_string());
    }
    if !matches!(
        options.safe_area.as_str(),
        "auto" | "left" | "right" | "center" | "none"
    ) {
        return Err("Theme safe area is invalid.".to_string());
    }
    if !matches!(
        options.task_mode.as_str(),
        "auto" | "ambient" | "banner" | "off"
    ) {
        return Err("Theme task mode is invalid.".to_string());
    }
    for focus in [options.focus_x, options.focus_y].into_iter().flatten() {
        if !focus.is_finite() || !(0.0..=1.0).contains(&focus) {
            return Err("Theme focus coordinates must be between 0 and 1.".to_string());
        }
    }
    Ok(())
}

pub(crate) fn import_image(
    app: &AppHandle,
    path: &str,
    options: &DreamSkinImportOptions,
) -> Result<(), String> {
    validate_import_options(options)?;
    let source = PathBuf::from(path);
    image_details(&source)?;
    ensure_no_reparse_points(&source)?;
    let _operation = OPERATION_LOCK
        .lock()
        .map_err(|_| "Dream Skin operation lock is unavailable.".to_string())?;
    let already_installed = marker_path()?.is_file();
    let paths = ensure_installed(app)?;
    let staging = state_root()?.join("import-staging");
    ensure_directory(&staging)?;
    let (mime, _, _) = image_details(&source)?;
    let extension = match mime {
        "image/png" => "png",
        "image/webp" => "webp",
        _ => "jpg",
    };
    let image_name = format!("art.{extension}");
    fs::copy(&source, staging.join(&image_name))
        .map_err(|error| format!("Failed to import theme image: {error}"))?;
    let document = json!({
        "schemaVersion": 1,
        "id": "custom",
        "name": options.name.trim(),
        "brandSubtitle": "CODEX DREAM SKIN",
        "tagline": "Make something wonderful.",
        "projectPrefix": "Select project - ",
        "projectLabel": "Select project",
        "statusText": "DREAM SKIN ONLINE",
        "quote": "MAKE SOMETHING WONDERFUL",
        "image": image_name,
        "appearance": options.appearance,
        "art": {
            "focusX": options.focus_x,
            "focusY": options.focus_y,
            "safeArea": options.safe_area,
            "taskMode": options.task_mode
        },
        "palette": {}
    });
    write_json(&staging.join("theme.json"), &document)?;
    copy_theme_to_active(&staging)?;
    save_current_theme(&options.name)?;
    let _ = fs::remove_file(pause_path()?);
    if already_installed {
        ensure_monitor(paths);
        wake_monitor();
        Ok(())
    } else {
        restart_managed_runtime(&paths, SkinVerificationMode::Required)
    }
}

pub(crate) fn save_theme(app: &AppHandle, name: &str) -> Result<(), String> {
    let _operation = OPERATION_LOCK
        .lock()
        .map_err(|_| "Dream Skin operation lock is unavailable.".to_string())?;
    ensure_installed(app)?;
    save_current_theme(name)?;
    Ok(())
}

fn validate_deletable_theme_id(theme_id: &str) -> Result<(), String> {
    if !valid_theme_id(theme_id) || BUILT_IN_THEME_IDS.contains(&theme_id) {
        return Err("Only saved community themes can be deleted.".to_string());
    }
    Ok(())
}

fn deletable_theme_directory(theme_id: &str) -> Result<PathBuf, String> {
    validate_deletable_theme_id(theme_id)?;
    let directory = themes_root()?.join(theme_id);
    let metadata = fs::symlink_metadata(&directory)
        .map_err(|_| format!("Saved theme does not exist: {theme_id}"))?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err(format!(
            "Saved theme is not a managed directory: {theme_id}"
        ));
    }
    ensure_no_reparse_points(&directory)?;
    saved_theme_directory(theme_id)
}

pub(crate) fn delete_themes(theme_ids: &[String]) -> Result<(), String> {
    if theme_ids.is_empty() {
        return Err("Select at least one saved theme to delete.".to_string());
    }
    let _operation = OPERATION_LOCK
        .lock()
        .map_err(|_| "Dream Skin operation lock is unavailable.".to_string())?;
    let unique_ids = theme_ids.iter().collect::<HashSet<_>>();
    let directories = unique_ids
        .into_iter()
        .map(|theme_id| deletable_theme_directory(theme_id).map(|path| (theme_id, path)))
        .collect::<Result<Vec<_>, _>>()?;
    for (theme_id, directory) in directories {
        fs::remove_dir_all(directory)
            .map_err(|_| format!("Failed to delete saved theme: {theme_id}"))?;
    }
    Ok(())
}
