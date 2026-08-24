use std::{
    fs,
    io::{self, Cursor, Read},
    path::{Component, Path, PathBuf},
    time::Duration,
};

use reqwest::blocking::Client;
use zip::ZipArchive;

const REPOSITORY_URL: &str = "https://codeload.github.com/openai/plugins/zip/refs/heads/main";
const MAX_ARCHIVE_BYTES: u64 = 200 * 1024 * 1024;
const MAX_EXTRACTED_BYTES: u64 = 500 * 1024 * 1024;
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(45);

pub(super) fn ensure_snapshot(codex_home: &Path) -> Result<PathBuf, String> {
    let repository = codex_home.join(".tmp").join("plugins");
    if has_marketplace_manifest(&repository) {
        return Ok(repository);
    }

    download_snapshot(&repository)?;
    Ok(repository)
}

fn has_marketplace_manifest(repository: &Path) -> bool {
    ["marketplace.json", "api_marketplace.json"]
        .iter()
        .any(|name| repository.join(".agents/plugins").join(name).is_file())
}

fn download_snapshot(repository: &Path) -> Result<(), String> {
    let client = crate::system_proxy::apply(Client::builder())
        .timeout(DOWNLOAD_TIMEOUT)
        .user_agent("Codex-Switch official plugin catalog")
        .build()
        .map_err(|error| {
            format!("Could not prepare the official plugin catalog request: {error}")
        })?;
    let response = client
        .get(REPOSITORY_URL)
        .send()
        .map_err(|error| format!("Could not download the official plugin catalog: {error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "The official plugin catalog returned HTTP {}.",
            response.status()
        ));
    }

    let mut archive = Vec::new();
    response
        .take(MAX_ARCHIVE_BYTES + 1)
        .read_to_end(&mut archive)
        .map_err(|error| format!("Could not read the official plugin catalog: {error}"))?;
    if archive.len() as u64 > MAX_ARCHIVE_BYTES {
        return Err("The official plugin catalog download is too large.".to_string());
    }

    let parent = repository
        .parent()
        .ok_or_else(|| "The official plugin catalog path is invalid.".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Could not prepare the official plugin catalog: {error}"))?;
    let staging = parent.join(format!("plugins-download-{}", std::process::id()));
    if staging.exists() {
        fs::remove_dir_all(&staging)
            .map_err(|error| format!("Could not reset the official plugin catalog: {error}"))?;
    }
    fs::create_dir_all(&staging)
        .map_err(|error| format!("Could not prepare the official plugin catalog: {error}"))?;

    let extraction = extract_archive(&archive, &staging);
    if let Err(error) = extraction {
        return match fs::remove_dir_all(&staging) {
            Ok(()) => Err(error),
            Err(_) => Err(format!("{error} Please try again later.")),
        };
    }
    if repository.exists() {
        fs::remove_dir_all(repository)
            .map_err(|error| format!("Could not replace the official plugin catalog: {error}"))?;
    }
    fs::rename(&staging, repository)
        .map_err(|error| format!("Could not activate the official plugin catalog: {error}"))
}

fn extract_archive(bytes: &[u8], destination: &Path) -> Result<(), String> {
    let mut archive = ZipArchive::new(Cursor::new(bytes))
        .map_err(|error| format!("The official plugin catalog archive is invalid: {error}"))?;
    let mut extracted_bytes = 0_u64;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|error| {
            format!("Could not read the official plugin catalog archive: {error}")
        })?;
        let Some(relative) = archive_relative_path(entry.name())? else {
            continue;
        };
        let target = destination.join(relative);
        if entry.is_dir() {
            fs::create_dir_all(&target).map_err(|error| {
                format!("Could not extract the official plugin catalog: {error}")
            })?;
            continue;
        }
        let parent = target.parent().ok_or_else(|| {
            "The official plugin catalog archive contains an invalid path.".to_string()
        })?;
        fs::create_dir_all(parent)
            .map_err(|error| format!("Could not extract the official plugin catalog: {error}"))?;
        extracted_bytes = extracted_bytes
            .checked_add(entry.size())
            .ok_or_else(|| "The official plugin catalog is too large to extract.".to_string())?;
        if extracted_bytes > MAX_EXTRACTED_BYTES {
            return Err("The official plugin catalog is too large to extract.".to_string());
        }
        let mut output = fs::File::create(&target)
            .map_err(|error| format!("Could not extract the official plugin catalog: {error}"))?;
        io::copy(&mut entry, &mut output)
            .map_err(|error| format!("Could not extract the official plugin catalog: {error}"))?;
    }
    let entries = fs::read_dir(destination)
        .map_err(|error| format!("Could not inspect the official plugin catalog: {error}"))?
        .filter_map(Result::ok)
        .collect::<Vec<_>>();
    if entries.len() != 1 || !entries[0].path().is_dir() {
        return Err("The official plugin catalog archive has an unexpected layout.".to_string());
    }
    let root = entries[0].path();
    for entry in fs::read_dir(&root)
        .map_err(|error| format!("Could not inspect the official plugin catalog: {error}"))?
    {
        let entry = entry
            .map_err(|error| format!("Could not inspect the official plugin catalog: {error}"))?;
        fs::rename(entry.path(), destination.join(entry.file_name()))
            .map_err(|error| format!("Could not activate the official plugin catalog: {error}"))?;
    }
    fs::remove_dir_all(root)
        .map_err(|error| format!("Could not clean up the official plugin catalog: {error}"))
}

fn archive_relative_path(name: &str) -> Result<Option<PathBuf>, String> {
    let path = Path::new(name);
    let mut components = path.components();
    if !matches!(components.next(), Some(Component::Normal(_))) {
        return Err("The official plugin catalog archive contains an unsafe path.".to_string());
    }
    let mut relative = PathBuf::new();
    for component in components {
        match component {
            Component::Normal(part) => relative.push(part),
            Component::CurDir => {}
            _ => {
                return Err(
                    "The official plugin catalog archive contains an unsafe path.".to_string(),
                )
            }
        }
    }
    if relative.as_os_str().is_empty() {
        return Ok(None);
    }
    Ok(Some(relative))
}
