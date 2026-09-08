use std::{
    fs,
    path::{Path, PathBuf},
};

use super::{BrowserError, Result};

macro_rules! assets {
    ($($name:literal),+ $(,)?) => {
        &[$(($name, include_bytes!(concat!("../../resources/chrome-extension/", $name)).as_slice())),+]
    };
}

const ASSETS: &[(&str, &[u8])] = assets![
    "manifest.json",
    "background.js",
    "validation.js",
    "permissions.js",
    "driver.js",
    "frame-sessions.js",
    "snapshot.js",
    "actions.js",
    "operations.js",
    "popup.html",
    "popup.js",
    "approval.html",
    "approval.js",
    "ui.css",
    "icon.png",
];

pub(super) fn directory(root: &Path) -> PathBuf {
    root.join("extension")
}

pub(super) fn export(root: &Path) -> Result<PathBuf> {
    let path = directory(root);
    fs::create_dir_all(&path).map_err(|_| BrowserError::Storage)?;
    for (name, bytes) in ASSETS {
        let target = path.join(name);
        if fs::read(&target).ok().as_deref() == Some(bytes) {
            continue;
        }
        fs::write(target, bytes).map_err(|_| BrowserError::Storage)?;
    }
    Ok(path)
}

pub(super) fn skill(home: &Path) -> Result<()> {
    let path = home.join("skills").join("codex-switch-chrome");
    let manifest = path.join("SKILL.md");
    if manifest.exists() {
        let existing = fs::read_to_string(&manifest).map_err(|_| BrowserError::Storage)?;
        if !existing.contains("<!-- managed:codex-switch-chrome -->") {
            return Err(BrowserError::Conflict);
        }
    }
    fs::create_dir_all(path).map_err(|_| BrowserError::Storage)?;
    crate::storage::write_text_atomic(
        &manifest,
        include_str!("../../resources/chrome-extension/SKILL.md"),
    )
    .map_err(|_| BrowserError::Storage)
}

pub(super) fn remove_skill(home: &Path) -> Result<()> {
    let path = home
        .join("skills")
        .join("codex-switch-chrome")
        .join("SKILL.md");
    if !path.exists() {
        return Ok(());
    }
    let existing = fs::read_to_string(&path).map_err(|_| BrowserError::Storage)?;
    if !existing.contains("<!-- managed:codex-switch-chrome -->") {
        return Ok(());
    }
    fs::remove_file(path).map_err(|_| BrowserError::Storage)
}
