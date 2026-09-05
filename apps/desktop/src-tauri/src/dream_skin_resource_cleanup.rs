use std::{
    fs, io,
    path::{Path, PathBuf},
};

use uuid::{Uuid, Variant, Version};

const DOWNLOAD_PREFIX: &str = ".download-";
const DOWNLOAD_SUFFIX: &str = ".zip";
const STAGING_PREFIX: &str = ".staging-";

enum CacheEntryKind {
    Archive,
    Directory,
}

/// Run only while the single-instance resource updater owns UPDATE_RUNNING,
/// before starting a download, so every matching temporary entry is abandoned.
pub(super) fn cleanup_resource_cache(root: &Path, current_version: Option<&str>) -> io::Result<()> {
    let Some(root) = validated_root(root)? else {
        return Ok(());
    };
    for entry in fs::read_dir(&root)? {
        let entry = entry?;
        let name = entry.file_name();
        let Some(kind) = name
            .to_str()
            .and_then(|name| cache_entry_kind(name, current_version))
        else {
            continue;
        };
        remove_cache_entry(&root, &entry.path(), kind)?;
    }
    Ok(())
}

fn cache_entry_kind(name: &str, current_version: Option<&str>) -> Option<CacheEntryKind> {
    if name
        .strip_prefix(DOWNLOAD_PREFIX)
        .and_then(|name| name.strip_suffix(DOWNLOAD_SUFFIX))
        .is_some_and(is_download_id)
    {
        return Some(CacheEntryKind::Archive);
    }
    if name
        .strip_prefix(STAGING_PREFIX)
        .is_some_and(is_download_id)
        || current_version.is_some_and(|current| name != current && super::valid_version(name))
    {
        return Some(CacheEntryKind::Directory);
    }
    None
}

fn is_download_id(value: &str) -> bool {
    Uuid::parse_str(value).is_ok_and(|id| {
        id.get_variant() == Variant::RFC4122
            && id.get_version() == Some(Version::Random)
            && id.to_string() == value
    })
}

fn validated_root(root: &Path) -> io::Result<Option<PathBuf>> {
    if !root.is_absolute() {
        return Err(io::Error::other(
            "The theme cache location must be absolute.",
        ));
    }
    for ancestor in root.ancestors() {
        match fs::symlink_metadata(ancestor) {
            Ok(metadata) if is_link(&metadata) => {
                return Err(io::Error::other(
                    "The theme cache location contains a link.",
                ));
            }
            Ok(_) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
    }
    match fs::symlink_metadata(root) {
        Ok(metadata) if metadata.is_dir() => root.canonicalize().map(Some),
        Ok(_) => Err(io::Error::other(
            "The theme cache location is not a directory.",
        )),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error),
    }
}

fn remove_cache_entry(root: &Path, path: &Path, kind: CacheEntryKind) -> io::Result<()> {
    let metadata = fs::symlink_metadata(path)?;
    if is_link(&metadata) {
        return Ok(());
    }
    // Resolve and bound every deletion to a direct child of the validated cache.
    let resolved = path.canonicalize()?;
    if resolved.parent() != Some(root) {
        return Err(io::Error::other(
            "A theme cache entry is outside the cache location.",
        ));
    }
    match kind {
        CacheEntryKind::Archive if metadata.is_file() => fs::remove_file(resolved),
        CacheEntryKind::Directory if metadata.is_dir() && regular_tree(&resolved)? => {
            fs::remove_dir_all(resolved)
        }
        _ => Ok(()),
    }
}

fn regular_tree(root: &Path) -> io::Result<bool> {
    let mut directories = vec![root.to_path_buf()];
    while let Some(directory) = directories.pop() {
        for entry in fs::read_dir(directory)? {
            let entry = entry?;
            let metadata = fs::symlink_metadata(entry.path())?;
            if is_link(&metadata) || (!metadata.is_file() && !metadata.is_dir()) {
                return Ok(false);
            }
            if metadata.is_dir() {
                directories.push(entry.path());
            }
        }
    }
    Ok(true)
}

fn is_link(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
        metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
    }
    #[cfg(not(windows))]
    {
        metadata.file_type().is_symlink()
    }
}

#[cfg(test)]
#[path = "dream_skin_resource_cleanup_tests.rs"]
mod tests;
