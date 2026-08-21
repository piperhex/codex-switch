fn normalize_theme_document(mut document: Value, fallback_id: &str) -> Result<Value, String> {
    let object = document
        .as_object_mut()
        .ok_or_else(|| "Theme metadata root must be an object.".to_string())?;
    let id = object
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or(fallback_id);
    if !valid_theme_id(id) {
        return Err("Theme id is invalid.".to_string());
    }
    object.insert("id".to_string(), Value::String(id.to_string()));

    let name = object
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or("Codex Dream Skin");
    if name.trim().is_empty() || name.chars().count() > 120 || name.chars().any(char::is_control) {
        return Err("Theme name is invalid.".to_string());
    }
    object.insert("name".to_string(), Value::String(name.to_string()));

    let appearance = object
        .get("appearance")
        .and_then(Value::as_str)
        .unwrap_or("auto");
    if !matches!(appearance, "auto" | "light" | "dark") {
        return Err("Theme appearance is invalid.".to_string());
    }
    object.insert(
        "appearance".to_string(),
        Value::String(appearance.to_string()),
    );

    let art = object
        .entry("art")
        .or_insert_with(|| Value::Object(Map::new()))
        .as_object_mut()
        .ok_or_else(|| "Theme art settings must be an object.".to_string())?;
    for key in ["focusX", "focusY"] {
        if let Some(value) = art.get(key).filter(|value| !value.is_null()) {
            let number = value
                .as_f64()
                .filter(|number| number.is_finite() && (0.0..=1.0).contains(number))
                .ok_or_else(|| format!("Theme {key} must be between 0 and 1."))?;
            art.insert(key.to_string(), json!(number));
        }
    }
    if let Some(value) = art.get("overlayOpacity").filter(|value| !value.is_null()) {
        let opacity = value
            .as_f64()
            .filter(|number| number.is_finite() && (0.0..=1.0).contains(number))
            .ok_or_else(|| "Theme overlay opacity must be between 0 and 1.".to_string())?;
        art.insert("overlayOpacity".to_string(), json!(opacity));
    }
    let safe_area = art
        .get("safeArea")
        .and_then(Value::as_str)
        .unwrap_or("auto")
        .to_string();
    if !matches!(
        safe_area.as_str(),
        "auto" | "left" | "right" | "center" | "none"
    ) {
        return Err("Theme safe area is invalid.".to_string());
    }
    let task_mode = art
        .get("taskMode")
        .and_then(Value::as_str)
        .unwrap_or("auto")
        .to_string();
    if !matches!(task_mode.as_str(), "auto" | "ambient" | "banner" | "off") {
        return Err("Theme task mode is invalid.".to_string());
    }
    art.insert("safeArea".to_string(), Value::String(safe_area));
    art.insert("taskMode".to_string(), Value::String(task_mode));
    object
        .entry("palette")
        .or_insert_with(|| Value::Object(Map::new()));
    Ok(document)
}

fn load_theme(directory: &Path) -> Result<LoadedTheme, String> {
    ensure_no_reparse_points(directory)?;
    let canonical_directory = directory
        .canonicalize()
        .map_err(|error| format!("Failed to resolve {}: {error}", directory.display()))?;
    let theme_path = canonical_directory.join("theme.json");
    ensure_no_reparse_points(&theme_path)?;
    let bytes = fs::read(&theme_path)
        .map_err(|error| format!("Failed to read {}: {error}", theme_path.display()))?;
    let raw: Value = serde_json::from_slice(&bytes)
        .map_err(|error| format!("Invalid {}: {error}", theme_path.display()))?;
    let fallback_id = canonical_directory
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| valid_theme_id(name))
        .unwrap_or("custom");
    let mut document = normalize_theme_document(raw, fallback_id)?;
    let image_name = document
        .get("image")
        .and_then(Value::as_str)
        .ok_or_else(|| "Theme image must be a relative file name.".to_string())?;
    let image_component = Path::new(image_name);
    if image_component.is_absolute()
        || image_component.components().count() != 1
        || image_component.file_name().and_then(|name| name.to_str()) != Some(image_name)
    {
        return Err("Theme image must be a relative file name.".to_string());
    }
    let image_path = canonical_directory.join(image_component);
    ensure_no_reparse_points(&image_path)?;
    let canonical_image = image_path
        .canonicalize()
        .map_err(|error| format!("Failed to resolve {}: {error}", image_path.display()))?;
    if !canonical_image.starts_with(&canonical_directory) {
        return Err("Theme image escapes its theme directory.".to_string());
    }
    let (mime, width, height) = image_details(&canonical_image)?;
    let image_bytes = fs::read(&canonical_image)
        .map_err(|error| format!("Failed to read {}: {error}", canonical_image.display()))?;
    let ratio = f64::from(width) / f64::from(height);
    let aspect = if ratio >= 2.25 {
        "ultrawide"
    } else if ratio >= 1.45 {
        "wide"
    } else if ratio >= 1.08 {
        "landscape"
    } else if ratio >= 0.9 {
        "square"
    } else {
        "portrait"
    };
    document.as_object_mut().unwrap().insert(
        "artMetadata".to_string(),
        json!({
            "width": width,
            "height": height,
            "ratio": ratio,
            "wide": ratio >= 1.75,
            "aspect": aspect,
            "taskMode": if ratio >= 2.25 { "banner" } else { "ambient" }
        }),
    );
    Ok(LoadedTheme {
        document,
        image_path: canonical_image,
        image_bytes,
        mime,
    })
}

fn copy_theme_to_active(source: &Path) -> Result<(), String> {
    let loaded = load_theme(source)?;
    let active = active_theme_root()?;
    ensure_directory(&active)?;
    let extension = match loaded.mime {
        "image/png" => "png",
        "image/webp" => "webp",
        _ => "jpg",
    };
    let image_name = format!("art-{}.{}", Uuid::new_v4().simple(), extension);
    let target = active.join(&image_name);
    fs::write(&target, &loaded.image_bytes)
        .map_err(|error| format!("Failed to write {}: {error}", target.display()))?;
    image_details(&target)?;

    let old_image = load_theme(&active).ok().map(|theme| theme.image_path);
    let mut document = loaded.document;
    document
        .as_object_mut()
        .unwrap()
        .insert("image".to_string(), Value::String(image_name));
    write_json(&active.join("theme.json"), &document)?;
    if let Some(old_image) = old_image.filter(|path| path != &target && path.starts_with(&active)) {
        let _ = fs::remove_file(old_image);
    }
    Ok(())
}

fn save_current_theme(name: &str) -> Result<String, String> {
    let name = validate_name(name)?;
    let active = load_theme(&active_theme_root()?)?;
    let id = format!(
        "{}-{}",
        chrono::Local::now().format("%Y%m%d-%H%M%S"),
        &Uuid::new_v4().simple().to_string()[..8]
    );
    let destination = themes_root()?.join(&id);
    ensure_directory(&destination)?;
    let extension = match active.mime {
        "image/png" => "png",
        "image/webp" => "webp",
        _ => "jpg",
    };
    let image_name = format!("art.{extension}");
    fs::write(destination.join(&image_name), &active.image_bytes)
        .map_err(|error| format!("Failed to save theme image: {error}"))?;
    let mut document = active.document;
    let object = document.as_object_mut().unwrap();
    object.insert("id".to_string(), Value::String(id.clone()));
    object.insert("name".to_string(), Value::String(name.to_string()));
    object.insert("image".to_string(), Value::String(image_name));
    write_json(&destination.join("theme.json"), &document)?;
    Ok(id)
}

pub(crate) fn install_market_theme(
    document: Value,
    image_bytes: &[u8],
    extension: &str,
) -> Result<(), String> {
    let id = document
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| "Community theme id is missing.".to_string())?
        .to_string();
    if !valid_theme_id(&id) || BUILT_IN_THEME_IDS.contains(&id.as_str()) {
        return Err("Community theme id conflicts with a built-in theme.".to_string());
    }
    if !matches!(extension, "png" | "jpg" | "webp") {
        return Err("Community theme image format is not supported.".to_string());
    }

    let mut document = normalize_theme_document(document, &id)?;
    let destination = themes_root()?.join(&id);
    ensure_directory(&destination)?;
    let old_image = load_theme(&destination).ok().map(|theme| theme.image_path);
    let image_name = format!("art-{}.{}", Uuid::new_v4().simple(), extension);
    let image_path = destination.join(&image_name);
    fs::write(&image_path, image_bytes)
        .map_err(|error| format!("Failed to save the community theme image: {error}"))?;
    if let Err(error) = image_details(&image_path) {
        let _ = fs::remove_file(&image_path);
        return Err(error);
    }
    document
        .as_object_mut()
        .expect("normalized theme is an object")
        .insert("image".to_string(), Value::String(image_name));
    if let Err(error) = write_json(&destination.join("theme.json"), &document) {
        let _ = fs::remove_file(&image_path);
        return Err(error);
    }
    if let Some(old_image) =
        old_image.filter(|path| path != &image_path && path.starts_with(&destination))
    {
        let _ = fs::remove_file(old_image);
    }
    Ok(())
}

fn saved_theme_directory(theme_id: &str) -> Result<PathBuf, String> {
    if !valid_theme_id(theme_id) {
        return Err("Theme id is invalid.".to_string());
    }
    let root = themes_root()?;
    let directory = root.join(theme_id);
    let canonical_root = root
        .canonicalize()
        .map_err(|error| format!("Failed to resolve {}: {error}", root.display()))?;
    let canonical_directory = directory
        .canonicalize()
        .map_err(|error| format!("Theme does not exist: {theme_id}: {error}"))?;
    if !canonical_directory.starts_with(&canonical_root) {
        return Err("Theme directory escapes the managed theme library.".to_string());
    }
    Ok(canonical_directory)
}
