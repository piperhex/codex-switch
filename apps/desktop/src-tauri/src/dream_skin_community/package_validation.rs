fn validate_package(bytes: &[u8]) -> Result<ValidatedPackage, String> {
    if bytes.is_empty() || bytes.len() > PACKAGE_LIMIT {
        return Err("The DreamSkin theme package exceeds 32 MB.".to_string());
    }
    let mut archive = ZipArchive::new(Cursor::new(bytes))
        .map_err(|_| "The DreamSkin theme package is not a valid ZIP file.".to_string())?;
    if archive.is_empty() || archive.len() > ARCHIVE_FILE_LIMIT {
        return Err("The DreamSkin theme package contains too many files.".to_string());
    }

    let mut files = HashMap::<String, Vec<u8>>::new();
    let mut root: Option<String> = None;
    let mut saw_root_file = false;
    let mut unpacked = 0usize;
    for index in 0..archive.len() {
        let file = archive
            .by_index(index)
            .map_err(|_| "A DreamSkin package entry could not be read.".to_string())?;
        if file.is_dir() {
            continue;
        }
        if file.encrypted()
            || file
                .unix_mode()
                .is_some_and(|mode| mode & 0o170000 == 0o120000)
        {
            return Err("The DreamSkin package contains a link or encrypted file.".to_string());
        }
        let enclosed = file
            .enclosed_name()
            .ok_or_else(|| "The DreamSkin package contains an unsafe path.".to_string())?;
        if enclosed
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
        {
            return Err("The DreamSkin package contains an unsafe path.".to_string());
        }
        let parts = enclosed
            .iter()
            .map(|part| part.to_string_lossy().into_owned())
            .collect::<Vec<_>>();
        if parts.last().is_some_and(|name| name == ".DS_Store")
            || parts.first().is_some_and(|name| name == "__MACOSX")
        {
            continue;
        }
        let name = match parts.as_slice() {
            [name] => {
                if root.is_some() {
                    return Err("DreamSkin package files must share one root folder.".to_string());
                }
                saw_root_file = true;
                name.clone()
            }
            [folder, name] => {
                if saw_root_file || root.as_deref().is_some_and(|current| current != folder) {
                    return Err("DreamSkin package files must share one root folder.".to_string());
                }
                root.get_or_insert_with(|| folder.clone());
                name.clone()
            }
            _ => return Err("The DreamSkin package contains nested folders.".to_string()),
        };
        let limit = package_file_limit(&name)?;
        let mut content = Vec::new();
        file.take((limit + 1) as u64)
            .read_to_end(&mut content)
            .map_err(|_| "A DreamSkin package file could not be read.".to_string())?;
        if content.is_empty() || content.len() > limit {
            return Err(format!("The DreamSkin package file {name} is too large."));
        }
        unpacked = unpacked.saturating_add(content.len());
        if unpacked > UNPACKED_LIMIT || files.insert(name.clone(), content).is_some() {
            return Err(
                "The DreamSkin package is too large or contains duplicate files.".to_string(),
            );
        }
    }

    let manifest_bytes = files
        .remove("manifest.json")
        .ok_or_else(|| "The DreamSkin package is missing manifest.json.".to_string())?;
    let theme_bytes = files
        .remove("theme.json")
        .ok_or_else(|| "The DreamSkin package is missing theme.json.".to_string())?;
    let css_bytes = files
        .remove("theme.css")
        .ok_or_else(|| "The DreamSkin package is missing theme.css.".to_string())?;
    std::str::from_utf8(&css_bytes)
        .map_err(|_| "The DreamSkin theme stylesheet is invalid.".to_string())?;
    let image_names = ["background.png", "background.jpg", "background.webp"];
    let present_images = image_names
        .iter()
        .filter(|name| files.contains_key(**name))
        .copied()
        .collect::<Vec<_>>();
    if present_images.len() != 1 {
        return Err("The DreamSkin package must contain exactly one background image.".to_string());
    }
    let image_name = present_images[0];
    let image_bytes = files.remove(image_name).expect("image was checked");
    let image_extension = image_extension(&image_bytes)
        .filter(|extension| *extension == image_name.trim_start_matches("background."))
        .ok_or_else(|| {
            "The DreamSkin background image format does not match its name.".to_string()
        })?;
    let license_bytes = files.remove("LICENSE.txt");
    let _signature = files.remove("manifest.sig");
    if !files.is_empty() {
        return Err("The DreamSkin package contains unsupported files.".to_string());
    }

    let manifest: PackageManifest = serde_json::from_slice(&manifest_bytes)
        .map_err(|_| "The DreamSkin package manifest is invalid.".to_string())?;
    validate_package_manifest(&manifest)?;
    let theme: Value = serde_json::from_slice(&theme_bytes)
        .map_err(|_| "The DreamSkin theme settings are invalid.".to_string())?;
    if theme.get("schemaVersion").and_then(Value::as_u64) != Some(1)
        || theme.get("id").and_then(Value::as_str) != Some(manifest.theme_id.as_str())
        || theme.get("name").and_then(Value::as_str).is_none()
        || theme.get("image").and_then(Value::as_str) != Some(image_name)
    {
        return Err("The DreamSkin theme settings do not match the package manifest.".to_string());
    }
    validate_manifest_files(
        &manifest,
        &theme_bytes,
        &css_bytes,
        image_name,
        &image_bytes,
        license_bytes.as_deref(),
    )?;
    Ok(ValidatedPackage {
        manifest,
        theme,
        image_bytes,
        image_extension,
    })
}

fn validate_package_manifest(manifest: &PackageManifest) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    let platform = "windows";
    #[cfg(target_os = "macos")]
    let platform = "macos";
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let platform = std::env::consts::OS;

    let _metadata_is_present = (
        &manifest.publisher.id,
        &manifest.publisher.display_name,
        manifest.provenance.ai_generated,
        &manifest.provenance.summary,
        &manifest.created_at,
        &manifest.key_id,
    );
    if manifest.package_version != 1
        || manifest.skin_api_version != 1
        || !valid_theme_id(&manifest.theme_id)
        || !valid_semver(&manifest.version)
        || !valid_semver(&manifest.min_client_version)
        || !manifest.platforms.iter().any(|value| value == platform)
        || !manifest
            .capabilities
            .iter()
            .any(|value| value == "background")
        || manifest.license.trim().is_empty()
        || manifest.files.len() < 3
        || manifest.files.len() > 8
    {
        return Err("The DreamSkin package manifest is not compatible with this app.".to_string());
    }
    Ok(())
}

fn validate_manifest_files(
    manifest: &PackageManifest,
    theme_bytes: &[u8],
    css_bytes: &[u8],
    image_name: &str,
    image_bytes: &[u8],
    license_bytes: Option<&[u8]>,
) -> Result<(), String> {
    let mut seen = HashSet::new();
    for file in &manifest.files {
        if !seen.insert(file.path.as_str())
            || matches!(file.path.as_str(), "manifest.json" | "manifest.sig")
            || !valid_sha256(&file.sha256)
        {
            return Err(
                "The DreamSkin package manifest contains an invalid file entry.".to_string(),
            );
        }
        let (bytes, media_type) = match file.path.as_str() {
            "theme.json" => (theme_bytes, "application/json"),
            "theme.css" => (css_bytes, "text/css"),
            path if path == image_name => (
                image_bytes,
                match image_name {
                    "background.png" => "image/png",
                    "background.jpg" => "image/jpeg",
                    _ => "image/webp",
                },
            ),
            "LICENSE.txt" => (
                license_bytes.ok_or_else(|| {
                    "The DreamSkin package is missing its declared license file.".to_string()
                })?,
                "text/plain",
            ),
            _ => {
                return Err(
                    "The DreamSkin package manifest contains an unsupported file.".to_string(),
                )
            }
        };
        if file.media_type != media_type || file.bytes != bytes.len() {
            return Err("A DreamSkin package file does not match its manifest.".to_string());
        }
        verify_sha256(bytes, &file.sha256, &file.path)?;
    }
    if !seen.contains("theme.json") || !seen.contains("theme.css") || !seen.contains(image_name) {
        return Err("The DreamSkin package manifest is incomplete.".to_string());
    }
    if seen.contains("LICENSE.txt") != license_bytes.is_some() {
        return Err("The DreamSkin package license record is inconsistent.".to_string());
    }
    Ok(())
}

fn package_file_limit(name: &str) -> Result<usize, String> {
    match name {
        "manifest.json" | "LICENSE.txt" => Ok(TEXT_LIMIT),
        "manifest.sig" => Ok(4096),
        "theme.json" => Ok(THEME_LIMIT),
        "theme.css" => Ok(CSS_LIMIT),
        "background.png" | "background.jpg" | "background.webp" => Ok(IMAGE_LIMIT),
        _ => Err(format!(
            "The DreamSkin package contains an unsupported file: {name}"
        )),
    }
}
