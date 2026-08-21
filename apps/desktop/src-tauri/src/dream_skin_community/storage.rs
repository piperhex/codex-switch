fn community_root() -> Result<PathBuf, String> {
    Ok(state_root()?.join("community"))
}

fn cache_path(offset: usize, limit: usize) -> Result<PathBuf, String> {
    Ok(community_root()?.join(format!("page-{offset}-{limit}.json")))
}

fn install_records_path() -> Result<PathBuf, String> {
    Ok(community_root()?.join("installed.json"))
}

fn read_cached_page(offset: usize, limit: usize) -> Result<ApiPage, String> {
    let bytes = fs::read(cache_path(offset, limit)?)
        .map_err(|_| "No saved DreamSkin community page is available.".to_string())?;
    if bytes.len() > JSON_LIMIT {
        return Err("The saved DreamSkin community page is invalid.".to_string());
    }
    let page: ApiPage = serde_json::from_slice(&bytes)
        .map_err(|_| "The saved DreamSkin community page is invalid.".to_string())?;
    validate_page(&page, limit)?;
    Ok(page)
}

fn read_install_records() -> Result<InstallRecords, String> {
    let path = install_records_path()?;
    if !path.is_file() {
        return Ok(InstallRecords {
            schema_version: schema_version(),
            themes: BTreeMap::new(),
        });
    }
    let records: InstallRecords = serde_json::from_slice(
        &fs::read(path).map_err(|error| format!("Could not read installed themes: {error}"))?,
    )
    .map_err(|_| "The DreamSkin install record is invalid.".to_string())?;
    if records.schema_version != schema_version() {
        return Err("The DreamSkin install record needs a newer app version.".to_string());
    }
    Ok(records)
}

fn record_install(theme_id: &str, version: &str) -> Result<(), String> {
    let mut records = read_install_records()?;
    records
        .themes
        .insert(theme_id.to_string(), version.to_string());
    write_json(&install_records_path()?, &records)
}

fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "The DreamSkin data path is invalid.".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Could not prepare the DreamSkin data folder: {error}"))?;
    let temporary = parent.join(format!(".community-{}.tmp", Uuid::new_v4().simple()));
    let bytes = serde_json::to_vec(value)
        .map_err(|error| format!("Could not save DreamSkin community data: {error}"))?;
    fs::write(&temporary, bytes)
        .map_err(|error| format!("Could not save DreamSkin community data: {error}"))?;
    if path.is_file() {
        fs::remove_file(path)
            .map_err(|error| format!("Could not update DreamSkin community data: {error}"))?;
    }
    fs::rename(&temporary, path)
        .map_err(|error| format!("Could not finish saving DreamSkin community data: {error}"))
}

const fn schema_version() -> u8 {
    1
}
