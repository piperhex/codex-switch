use super::*;
use crate::computer_use::assets;
use flate2::{write::GzEncoder, Compression};
use std::{io::Write, path::PathBuf};

struct TemporaryDirectory(PathBuf);
impl TemporaryDirectory {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("csw-cua-archive-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&path).unwrap();
        Self(path)
    }
}
impl Drop for TemporaryDirectory {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}

fn tarball(members: &[(&str, tar::EntryType)]) -> Vec<u8> {
    let encoder = GzEncoder::new(Vec::new(), Compression::fast());
    let mut builder = tar::Builder::new(encoder);
    for (name, kind) in members {
        let mut header = tar::Header::new_gnu();
        header.set_entry_type(*kind);
        header.set_mode(0o644); // The installer, not the archive, supplies executable permissions.
        header.set_size(4);
        if kind.is_symlink() {
            header.set_link_name("outside").unwrap();
        }
        header.set_cksum();
        builder
            .append_data(&mut header, name, b"test".as_slice())
            .unwrap();
    }
    builder.into_inner().unwrap().finish().unwrap()
}

#[test]
fn installs_flat_macos_tarball_and_restores_executable_permissions() {
    let asset = assets::select("macos", "aarch64").unwrap();
    let members: Vec<_> = asset
        .files
        .iter()
        .map(|name| (*name, tar::EntryType::Regular))
        .collect();
    let directory = TemporaryDirectory::new();
    extract(&tarball(&members), "unused", &directory.0, &asset).unwrap();
    for name in asset.files {
        assert_eq!(fs::read(directory.0.join(name)).unwrap(), b"test");
    }
    assert!(platform::executable_present(
        &directory.0.join(asset.executable())
    ));
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let executable = directory.0.join(asset.executable());
        assert_eq!(
            executable.metadata().unwrap().permissions().mode() & 0o777,
            0o755
        );
        fs::set_permissions(&executable, fs::Permissions::from_mode(0o644)).unwrap();
        assert!(!platform::executable_present(&executable));
    }
}

#[test]
fn rejects_missing_duplicate_unexpected_and_linked_macos_members() {
    let asset = assets::select("macos", "x86_64").unwrap();
    for members in [
        vec![],
        vec![("cua-driver", tar::EntryType::Regular)],
        vec![
            ("cua-driver", tar::EntryType::Regular),
            ("cua-driver", tar::EntryType::Regular),
        ],
        vec![("unexpected/cua-driver", tar::EntryType::Regular)],
        vec![("cua-driver", tar::EntryType::Symlink)],
        vec![("cua-driver", tar::EntryType::Link)],
    ] {
        let directory = TemporaryDirectory::new();
        assert!(extract(&tarball(&members), "unused", &directory.0, &asset).is_err());
    }
}

#[test]
fn rejects_oversized_and_truncated_tar_payloads_before_installing() {
    let asset = assets::select("macos", "aarch64").unwrap();
    for size in [MAX_FILE_BYTES + 1, 4] {
        let mut header = tar::Header::new_gnu();
        header.set_path("cua-driver").unwrap();
        header.set_size(size);
        header.set_mode(0o755);
        header.set_cksum();
        let mut encoder = GzEncoder::new(Vec::new(), Compression::fast());
        encoder.write_all(header.as_bytes()).unwrap();
        let directory = TemporaryDirectory::new();
        assert!(extract(&encoder.finish().unwrap(), "unused", &directory.0, &asset).is_err());
    }
}

#[test]
fn preserves_windows_zip_layout_and_rejects_missing_files() {
    let asset = assets::select("windows", "x86_64").unwrap();
    let directory = TemporaryDirectory::new();
    let empty = zip::ZipWriter::new(Cursor::new(Vec::new()))
        .finish()
        .unwrap()
        .into_inner();
    assert!(extract(&empty, "release", &directory.0, &asset).is_err());
    let mut builder = zip::ZipWriter::new(Cursor::new(Vec::new()));
    for name in asset.files {
        builder
            .start_file(
                format!("release/{name}"),
                zip::write::SimpleFileOptions::default(),
            )
            .unwrap();
        builder.write_all(b"test").unwrap();
    }
    let bytes = builder.finish().unwrap().into_inner();
    extract(&bytes, "release", &directory.0, &asset).unwrap();
    assert_eq!(
        fs::read(directory.0.join(asset.executable())).unwrap(),
        b"test"
    );
}

#[test]
#[ignore = "requires CSW_CUA_TEST_ARCHIVE pointing to the pinned upstream macOS binary tarball"]
fn verifies_and_extracts_pinned_macos_release() {
    use sha2::{Digest, Sha256};
    let asset = assets::select("macos", "aarch64").unwrap();
    let bytes = fs::read(std::env::var_os("CSW_CUA_TEST_ARCHIVE").unwrap()).unwrap();
    assert_eq!(format!("{:x}", Sha256::digest(&bytes)), asset.digest);
    let directory = TemporaryDirectory::new();
    extract(&bytes, "unused", &directory.0, &asset).unwrap();
    let executable = fs::read(directory.0.join(asset.executable())).unwrap();
    assert_eq!(&executable[..8], &[0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 2]);
}
