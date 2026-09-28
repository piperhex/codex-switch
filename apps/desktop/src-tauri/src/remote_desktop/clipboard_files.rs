use super::clipboard::{ClipboardError, ClipboardFile, ClipboardResult, MAX_BYTES};
use base64::{engine::general_purpose::STANDARD, Engine};
use std::{
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
    time::{Duration, SystemTime},
};

const MAX_FILES: usize = 32;
const FILE_RETENTION: Duration = Duration::from_secs(24 * 60 * 60);

pub(super) fn read(paths: Vec<PathBuf>) -> ClipboardResult<Vec<ClipboardFile>> {
    if paths.is_empty() || paths.len() > MAX_FILES {
        return Err(ClipboardError::Size);
    }
    let mut remaining = MAX_BYTES;
    paths
        .into_iter()
        .map(|path| {
            if path.is_dir() {
                return Err(ClipboardError::Directory);
            }
            let file = File::open(&path).map_err(|_| ClipboardError::Access)?;
            let metadata = file.metadata().map_err(|_| ClipboardError::Access)?;
            if !metadata.is_file() {
                return Err(ClipboardError::Directory);
            }
            if metadata.len() > remaining as u64 {
                return Err(ClipboardError::Size);
            }
            let mut bytes = Vec::new();
            file.take(remaining as u64 + 1)
                .read_to_end(&mut bytes)
                .map_err(|_| ClipboardError::Access)?;
            if bytes.len() > remaining {
                return Err(ClipboardError::Size);
            }
            remaining -= bytes.len();
            let name = path
                .file_name()
                .and_then(|name| name.to_str())
                .ok_or(ClipboardError::Invalid)?;
            Ok(ClipboardFile {
                name: name.into(),
                data: STANDARD.encode(bytes),
            })
        })
        .collect()
}

pub(super) fn valid_name(name: &str) -> bool {
    if name.is_empty()
        || name.len() > 240
        || name.ends_with(['.', ' '])
        || name
            .chars()
            .any(|character| character.is_control() || "<>:\"/\\|?*".contains(character))
    {
        return false;
    }
    let stem = name
        .split('.')
        .next()
        .unwrap_or_default()
        .trim_end()
        .to_ascii_uppercase();
    !matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL" | "CLOCK$")
        && !["COM", "LPT"].iter().any(|prefix| {
            stem.strip_prefix(prefix).is_some_and(|suffix| {
                suffix.chars().count() == 1 && "123456789¹²³".contains(suffix)
            })
        })
}

/// Remote names never become paths outside this newly created, application-owned directory.
pub(super) fn write(files: Vec<ClipboardFile>) -> ClipboardResult<Vec<PathBuf>> {
    if files.is_empty() || files.len() > MAX_FILES {
        return Err(ClipboardError::Size);
    }
    let root = std::env::temp_dir().join("codex-switch-desktop-clipboard");
    fs::create_dir_all(&root).map_err(|_| ClipboardError::Access)?;
    cleanup(&root);
    let directory = root.join(uuid::Uuid::new_v4().to_string());
    fs::create_dir(&directory).map_err(|_| ClipboardError::Access)?;
    let result = save(&directory, files);
    if result.is_err() {
        if let Err(error) = fs::remove_dir_all(&directory) {
            eprintln!("desktop clipboard cleanup: {error}");
        }
    }
    result
}

fn save(directory: &Path, files: Vec<ClipboardFile>) -> ClipboardResult<Vec<PathBuf>> {
    let mut remaining = MAX_BYTES;
    files
        .into_iter()
        .map(|file| {
            if !valid_name(&file.name) {
                return Err(ClipboardError::Invalid);
            }
            if file.data.len() > remaining.div_ceil(3) * 4 {
                return Err(ClipboardError::Size);
            }
            let bytes = STANDARD
                .decode(file.data)
                .map_err(|_| ClipboardError::Invalid)?;
            if bytes.len() > remaining {
                return Err(ClipboardError::Size);
            }
            remaining -= bytes.len();
            let path = directory.join(file.name);
            let mut output = File::create_new(&path).map_err(|_| ClipboardError::Invalid)?;
            output
                .write_all(&bytes)
                .map_err(|_| ClipboardError::Access)?;
            Ok(path)
        })
        .collect()
}

fn cleanup(root: &Path) {
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        if uuid::Uuid::parse_str(&entry.file_name().to_string_lossy()).is_err() {
            continue;
        }
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        if !kind.is_dir() || kind.is_symlink() {
            continue;
        }
        let expired = entry
            .metadata()
            .and_then(|metadata| metadata.modified())
            .ok()
            .and_then(|modified| SystemTime::now().duration_since(modified).ok())
            .is_some_and(|age| age > FILE_RETENTION);
        if expired {
            if let Err(error) = fs::remove_dir_all(entry.path()) {
                eprintln!("desktop clipboard cleanup: {error}");
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_paths_devices_and_names_that_windows_normalizes() {
        for name in [
            "",
            "..",
            "../private",
            "C:\\secret",
            "a/b",
            "a:b",
            "NUL.txt",
            "COM1",
            "name.",
            "name ",
        ] {
            assert!(!valid_name(name), "{name}");
        }
        assert!(valid_name("报告 2026.txt"));
        assert!(valid_name("image.png"));
    }
    #[test]
    fn transfers_file_bytes_without_exposing_source_paths() {
        let files = vec![ClipboardFile {
            name: "clipboard-test.txt".into(),
            data: STANDARD.encode("hello 世界"),
        }];
        let paths = write(files).unwrap();
        let directory = paths[0].parent().unwrap().to_owned();
        let copied = read(paths).unwrap();
        assert_eq!(copied[0].name, "clipboard-test.txt");
        assert_eq!(
            STANDARD.decode(&copied[0].data).unwrap(),
            "hello 世界".as_bytes()
        );
        fs::remove_dir_all(directory).unwrap();
    }
}
