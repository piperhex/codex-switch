use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, io::Read, path::Path};

pub fn generate() {
    let root = std::path::PathBuf::from(
        std::env::var_os("CARGO_MANIFEST_DIR").expect("Cargo manifest directory"),
    );
    let mut entries = BTreeMap::new();
    for relative in ["resources/desktop-service", "resources/remote-desktop"] {
        let folder = root.join(relative);
        println!("cargo:rerun-if-changed={}", folder.display());
        if folder.is_dir() {
            collect(&root, &folder, &mut entries).expect("Desktop service assets must be readable");
        }
    }
    let path =
        std::path::PathBuf::from(std::env::var_os("OUT_DIR").expect("Cargo output directory"))
            .join("desktop-service-manifest.json");
    std::fs::write(
        path,
        serde_json::to_vec(&entries).expect("Serialize asset hashes"),
    )
    .expect("Write asset hashes");
}
fn collect(
    root: &Path,
    folder: &Path,
    entries: &mut BTreeMap<String, String>,
) -> std::io::Result<()> {
    for entry in std::fs::read_dir(folder)? {
        let entry = entry?;
        let path = entry.path();
        if entry.file_type()?.is_symlink() {
            return Err(std::io::Error::other("Linked service asset"));
        }
        if path.is_dir() {
            collect(root, &path, entries)?;
            continue;
        }
        let mut file = std::fs::File::open(&path)?;
        let mut hash = Sha256::new();
        let mut buffer = [0u8; 65536];
        loop {
            let length = file.read(&mut buffer)?;
            if length == 0 {
                break;
            }
            hash.update(&buffer[..length]);
        }
        let relative = path
            .strip_prefix(root)
            .map_err(std::io::Error::other)?
            .to_string_lossy()
            .replace('\\', "/");
        entries.insert(relative, format!("{:x}", hash.finalize()));
    }
    Ok(())
}
