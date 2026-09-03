pub(crate) fn account_dir(paths: &Paths, id: &str) -> PathBuf {
    paths.accounts.join(id)
}

pub(crate) fn managed_auth_path(paths: &Paths, id: &str) -> PathBuf {
    account_dir(paths, id).join("auth.json")
}

pub(crate) fn usage_path(paths: &Paths, id: &str) -> PathBuf {
    account_dir(paths, id).join("usage.json")
}

pub(crate) fn note_path(paths: &Paths, id: &str) -> PathBuf {
    account_dir(paths, id).join("note.txt")
}

pub(crate) fn account_group_path(paths: &Paths, id: &str) -> PathBuf {
    account_dir(paths, id).join("group.txt")
}

pub(crate) fn expiration_path(paths: &Paths, id: &str) -> PathBuf {
    account_dir(paths, id).join("expires-at.txt")
}

pub(crate) fn account_private_details_path(paths: &Paths, id: &str) -> PathBuf {
    account_dir(paths, id).join("private-details.json")
}

pub(crate) fn official_account_access_path(paths: &Paths, id: &str) -> PathBuf {
    account_dir(paths, id).join("official-account-access.json")
}

pub(crate) fn load_official_account_access(paths: &Paths, id: &str) -> (bool, bool) {
    let Ok(value) = read_json(&official_account_access_path(paths, id)) else {
        return (false, true);
    };
    let official = value
        .get("official")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let metadata_editable = value
        .get("metadataEditable")
        .and_then(Value::as_bool)
        .unwrap_or(!official);
    (official, metadata_editable)
}

pub(crate) fn auto_switch_priority_path(paths: &Paths, id: &str) -> PathBuf {
    account_dir(paths, id).join("auto-switch-priority.txt")
}

pub(crate) fn auto_switch_threshold_path(paths: &Paths, id: &str) -> PathBuf {
    account_dir(paths, id).join("auto-switch-threshold.txt")
}

pub(crate) fn last_modified_path(paths: &Paths, id: &str) -> PathBuf {
    account_dir(paths, id).join("last-modified-at.txt")
}

pub(crate) fn field_modified_at_path(paths: &Paths, id: &str) -> PathBuf {
    account_dir(paths, id).join("field-modified-at.json")
}

pub(crate) fn load_note(path: &Path) -> String {
    fs::read_to_string(path).unwrap_or_default()
}

pub(crate) fn load_account_group(path: &Path) -> String {
    fs::read_to_string(path)
        .unwrap_or_default()
        .trim()
        .to_string()
}

pub(crate) fn load_expiration(path: &Path) -> String {
    fs::read_to_string(path).unwrap_or_default()
}

pub(crate) fn load_account_private_details(path: &Path) -> AccountPrivateDetails {
    fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

pub(crate) fn load_auto_switch_priority(path: &Path) -> i32 {
    fs::read_to_string(path)
        .ok()
        .and_then(|value| value.trim().parse().ok())
        .unwrap_or_default()
}

pub(crate) fn load_auto_switch_threshold(path: &Path) -> f64 {
    fs::read_to_string(path)
        .ok()
        .and_then(|value| value.trim().parse().ok())
        .filter(|value: &f64| value.is_finite() && (0.0..=100.0).contains(value))
        .unwrap_or_default()
}
