fn marker_path() -> Result<PathBuf, String> {
    Ok(state_root()?.join("native-runtime.json"))
}

fn session_path() -> Result<PathBuf, String> {
    Ok(state_root()?.join("native-session.json"))
}

fn active_theme_root() -> Result<PathBuf, String> {
    Ok(state_root()?.join("active-theme"))
}

fn themes_root() -> Result<PathBuf, String> {
    Ok(state_root()?.join("themes"))
}

fn pause_path() -> Result<PathBuf, String> {
    Ok(state_root()?.join("paused"))
}

fn cdp_profile_path() -> Result<PathBuf, String> {
    Ok(state_root()?.join("cdp-profile"))
}

fn bundled_root(app: &AppHandle) -> Result<PathBuf, String> {
    let manifest_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join("dream-skin");
    let mut candidates = vec![manifest_root];
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.insert(0, resource_dir.join("dream-skin"));
        candidates.insert(1, resource_dir.join("resources").join("dream-skin"));
    }
    candidates
        .into_iter()
        .find(|path| {
            path.join("assets")
                .join("windows")
                .join("renderer-inject.js")
                .is_file()
                && path
                    .join("assets")
                    .join("macos")
                    .join("renderer-inject.js")
                    .is_file()
        })
        .ok_or_else(|| "The bundled Dream Skin assets are missing.".to_string())
}

fn built_in_theme_directory(root: &Path, theme_id: &str) -> Result<PathBuf, String> {
    if !BUILT_IN_THEME_IDS.contains(&theme_id) {
        return Err(format!("Unknown built-in theme: {theme_id}"));
    }
    let directory = root.join("presets").join(theme_id);
    if !directory.is_dir() {
        return Err(format!("Bundled theme is missing: {theme_id}"));
    }
    Ok(directory)
}

fn valid_theme_id(value: &str) -> bool {
    value
        .bytes()
        .next()
        .is_some_and(|byte| byte.is_ascii_alphanumeric())
        && value.len() <= 80
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
}

fn validate_name(value: &str) -> Result<&str, String> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > 80 || value.chars().any(char::is_control) {
        Err("Theme name must contain 1 to 80 visible characters.".to_string())
    } else {
        Ok(value)
    }
}

#[cfg(target_os = "windows")]
fn ensure_no_reparse_points(path: &Path) -> Result<(), String> {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;

    let mut current = Some(path);
    while let Some(candidate) = current {
        match fs::symlink_metadata(candidate) {
            Ok(metadata) if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 => {
                return Err(format!(
                    "Managed Dream Skin path contains a link or junction: {}",
                    candidate.display()
                ));
            }
            Ok(_) => {}
            Err(error) if error.kind() == ErrorKind::NotFound => {}
            Err(error) => {
                return Err(format!(
                    "Failed to inspect {}: {error}",
                    candidate.display()
                ));
            }
        }
        current = candidate.parent();
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn ensure_no_reparse_points(path: &Path) -> Result<(), String> {
    let mut current = Some(path);
    while let Some(candidate) = current {
        match fs::symlink_metadata(candidate) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err(format!(
                    "Managed Dream Skin path contains a symbolic link: {}",
                    candidate.display()
                ));
            }
            Ok(_) => {}
            Err(error) if error.kind() == ErrorKind::NotFound => {}
            Err(error) => {
                return Err(format!(
                    "Failed to inspect {}: {error}",
                    candidate.display()
                ));
            }
        }
        current = candidate.parent();
    }
    Ok(())
}

fn ensure_directory(path: &Path) -> Result<(), String> {
    ensure_no_reparse_points(path)?;
    fs::create_dir_all(path)
        .map_err(|error| format!("Failed to create {}: {error}", path.display()))?;
    ensure_no_reparse_points(path)?;
    if !path.is_dir() {
        return Err(format!(
            "Managed path is not a directory: {}",
            path.display()
        ));
    }
    Ok(())
}

fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("Path has no parent: {}", path.display()))?;
    ensure_directory(parent)?;
    ensure_no_reparse_points(path)?;
    let temporary = parent.join(format!(".dream-tmp-{}.json", Uuid::new_v4().simple()));
    let bytes = serde_json::to_vec_pretty(value)
        .map_err(|error| format!("Failed to serialize {}: {error}", path.display()))?;
    fs::write(&temporary, bytes)
        .map_err(|error| format!("Failed to write {}: {error}", temporary.display()))?;
    if path.exists() {
        fs::remove_file(path)
            .map_err(|error| format!("Failed to replace {}: {error}", path.display()))?;
    }
    fs::rename(&temporary, path)
        .map_err(|error| format!("Failed to publish {}: {error}", path.display()))
}

fn read_session() -> NativeSessionState {
    session_path()
        .ok()
        .and_then(|path| fs::read(path).ok())
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

fn write_session(state: &NativeSessionState) -> Result<(), String> {
    write_json(&session_path()?, state)
}

#[cfg(target_os = "windows")]
pub(crate) fn record_runtime_executable(executable: &Path) -> Result<(), String> {
    // Serialize read/modify/write with recovery so a path refresh cannot restore a spent attempt.
    let _operation = OPERATION_LOCK
        .lock()
        .map_err(|_| "Codex runtime operation lock is unavailable.".to_string())?;
    if !executable.is_file() {
        return Err("The recorded ChatGPT executable is no longer available.".to_string());
    }
    let executable = executable.display().to_string();
    let mut state = read_session();
    if state.codex_executable.as_deref() == Some(executable.as_str()) {
        return Ok(());
    }
    state.codex_executable = Some(executable);
    write_session(&state)
}

fn image_details(path: &Path) -> Result<(&'static str, u32, u32), String> {
    let metadata = fs::metadata(path)
        .map_err(|error| format!("Failed to inspect {}: {error}", path.display()))?;
    if !metadata.is_file() || metadata.len() == 0 {
        return Err("Theme image must be a non-empty file.".to_string());
    }
    if metadata.len() > MAX_ART_BYTES {
        return Err("Theme image exceeds the 16 MB limit.".to_string());
    }
    let reader = ImageReader::open(path)
        .map_err(|error| format!("Failed to open {}: {error}", path.display()))?
        .with_guessed_format()
        .map_err(|error| format!("Failed to identify {}: {error}", path.display()))?;
    let format = reader
        .format()
        .ok_or_else(|| "Unsupported theme image format.".to_string())?;
    let mime = match format {
        ImageFormat::Png => "image/png",
        ImageFormat::Jpeg => "image/jpeg",
        ImageFormat::WebP => "image/webp",
        _ => return Err("Only PNG, JPEG and WebP theme images are supported.".to_string()),
    };
    let (width, height) = reader
        .into_dimensions()
        .map_err(|error| format!("Invalid image metadata in {}: {error}", path.display()))?;
    if width == 0
        || height == 0
        || width > MAX_ART_DIMENSION
        || height > MAX_ART_DIMENSION
        || u64::from(width) * u64::from(height) > MAX_ART_PIXELS
    {
        return Err("Theme image exceeds the 16384 px / 50 MP safety limit.".to_string());
    }
    Ok((mime, width, height))
}
