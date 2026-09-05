use super::*;

const DOWNLOAD_ID: &str = "38de618c-8c65-4b23-924b-9242ea3a8066";
const CURRENT_VERSION: &str = "0123456789abcdef0123456789abcdef";
const OLD_VERSION: &str = "abcdef0123456789abcdef0123456789";

struct TestCache {
    base: PathBuf,
    root: PathBuf,
}

impl TestCache {
    fn new() -> Self {
        let temporary = std::env::temp_dir().canonicalize().unwrap();
        let base = temporary.join(format!("codex-switch-resource-cleanup-{}", Uuid::new_v4()));
        let root = base.join("resource-packs");
        fs::create_dir_all(&root).unwrap();
        Self { base, root }
    }

    fn archive(&self) -> PathBuf {
        self.root.join(format!(".download-{DOWNLOAD_ID}.zip"))
    }

    fn staging(&self) -> PathBuf {
        self.root.join(format!(".staging-{DOWNLOAD_ID}"))
    }
}

impl Drop for TestCache {
    fn drop(&mut self) {
        let temporary = std::env::temp_dir().canonicalize().unwrap();
        let resolved = self.base.canonicalize().unwrap();
        assert_eq!(resolved.parent(), Some(temporary.as_path()));
        assert!(resolved
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("codex-switch-resource-cleanup-"));
        fs::remove_dir_all(resolved).unwrap();
    }
}

#[test]
fn interrupted_first_download_is_cleaned_without_a_version_marker() {
    let cache = TestCache::new();
    fs::write(cache.archive(), b"partial archive").unwrap();
    let presets = cache.staging().join("presets").join("example");
    fs::create_dir_all(&presets).unwrap();
    fs::write(presets.join("art.webp"), b"partial image").unwrap();

    cleanup_resource_cache(&cache.root, None).unwrap();

    assert!(!cache.archive().exists());
    assert!(!cache.staging().exists());
    cleanup_resource_cache(&cache.root, None).unwrap();
}

#[test]
fn cleanup_preserves_current_version_and_unknown_entries() {
    let cache = TestCache::new();
    for name in [
        CURRENT_VERSION,
        OLD_VERSION,
        ".staging-not-a-uuid",
        "my-downloads",
    ] {
        fs::create_dir(cache.root.join(name)).unwrap();
    }
    for name in ["current.json", ".download-not-a-uuid.zip", "notes.txt"] {
        fs::write(cache.root.join(name), b"keep").unwrap();
    }
    cleanup_resource_cache(&cache.root, Some(CURRENT_VERSION)).unwrap();

    assert!(!cache.root.join(OLD_VERSION).exists());
    for name in [
        CURRENT_VERSION,
        ".staging-not-a-uuid",
        "my-downloads",
        "current.json",
        ".download-not-a-uuid.zip",
        "notes.txt",
    ] {
        assert!(cache.root.join(name).exists(), "removed {name}");
    }
}

#[test]
fn cleanup_preserves_versions_without_a_current_marker_and_wrong_entry_types() {
    let cache = TestCache::new();
    fs::create_dir(cache.root.join(OLD_VERSION)).unwrap();
    fs::create_dir(cache.archive()).unwrap();
    fs::write(cache.staging(), b"not a staging directory").unwrap();

    cleanup_resource_cache(&cache.root, None).unwrap();

    assert!(cache.root.join(OLD_VERSION).is_dir());
    assert!(cache.archive().is_dir());
    assert!(cache.staging().is_file());
}

#[test]
fn temporary_names_must_match_the_generated_uuid_format() {
    for name in [
        ".download-38de618c-8c65-4b23-924b-9242ea3a8066.zip.backup",
        ".download-38de618c8c654b23924b9242ea3a8066.zip",
        ".download-38DE618C-8C65-4B23-924B-9242EA3A8066.zip",
        ".staging-38de618c-8c65-1b23-924b-9242ea3a8066",
        ".staging-38de618c-8c65-4b23-124b-9242ea3a8066",
        ".staging-00000000-0000-0000-0000-000000000000",
    ] {
        assert!(cache_entry_kind(name, None).is_none(), "accepted {name}");
    }
}

#[test]
fn cleanup_rejects_linked_roots_and_preserves_linked_entries() {
    let cache = TestCache::new();
    let outside = cache.base.join("outside");
    fs::create_dir(&outside).unwrap();
    let sentinel = outside.join("keep.txt");
    fs::write(&sentinel, b"keep").unwrap();
    create_directory_link(&outside, &cache.staging());
    create_directory_link(&outside, &cache.root.join(OLD_VERSION));
    let linked_root = cache.base.join("linked-root");
    create_directory_link(&cache.root, &linked_root);

    assert!(cleanup_resource_cache(&linked_root, None).is_err());
    assert!(cleanup_resource_cache(&linked_root.join("missing-child"), None).is_err());
    cleanup_resource_cache(&cache.root, Some(CURRENT_VERSION)).unwrap();

    assert!(fs::symlink_metadata(cache.staging()).is_ok());
    assert!(fs::symlink_metadata(cache.root.join(OLD_VERSION)).is_ok());
    assert_eq!(fs::read(&sentinel).unwrap(), b"keep");
}

#[test]
fn cleanup_preserves_staging_trees_containing_links() {
    let cache = TestCache::new();
    let outside = cache.base.join("outside");
    fs::create_dir(&outside).unwrap();
    fs::write(outside.join("keep.txt"), b"keep").unwrap();
    fs::create_dir(cache.staging()).unwrap();
    create_directory_link(&outside, &cache.staging().join("linked-preset"));

    cleanup_resource_cache(&cache.root, None).unwrap();

    assert!(cache.staging().is_dir());
    assert_eq!(fs::read(outside.join("keep.txt")).unwrap(), b"keep");
}

#[cfg(unix)]
fn create_directory_link(target: &Path, link: &Path) {
    std::os::unix::fs::symlink(target, link).unwrap();
}

#[cfg(windows)]
fn create_directory_link(target: &Path, link: &Path) {
    use std::{os::windows::process::CommandExt, process::Command};
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    // Junction creation does not require Windows Developer Mode or elevation.
    let output = Command::new("cmd.exe")
        .args(["/D", "/C", "mklink", "/J"])
        .arg(link)
        .arg(target)
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
}
