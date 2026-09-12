//! Extract only pinned package members into installer-owned staging directories.
use super::{
    assets::{ArchiveFormat, Asset},
    platform, ComputerError, Result,
};
use std::{
    fs,
    io::{Cursor, Read},
    path::Path,
};

const MAX_FILE_BYTES: u64 = 128 * 1024 * 1024;
const MAX_UNPACKED_BYTES: u64 = 256 * 1024 * 1024;

pub(super) fn extract(bytes: &[u8], prefix: &str, destination: &Path, asset: &Asset) -> Result<()> {
    match asset.format {
        ArchiveFormat::Zip => extract_zip(bytes, prefix, destination, asset),
        ArchiveFormat::TarGz => extract_tar(bytes, destination, asset),
    }
}

fn extract_zip(bytes: &[u8], prefix: &str, destination: &Path, asset: &Asset) -> Result<()> {
    let mut archive =
        zip::ZipArchive::new(Cursor::new(bytes)).map_err(|_| ComputerError::Integrity)?;
    for name in asset.files {
        let mut member = archive
            .by_name(&format!("{prefix}/{name}"))
            .map_err(|_| ComputerError::Integrity)?;
        if !member.is_file() || member.is_symlink() {
            return Err(ComputerError::Integrity);
        }
        let size = member.size();
        write_member(&mut member, size, &destination.join(name))?;
    }
    Ok(())
}

fn extract_tar(bytes: &[u8], destination: &Path, asset: &Asset) -> Result<()> {
    let decoder = flate2::read::GzDecoder::new(bytes);
    let mut archive = tar::Archive::new(decoder.take(MAX_UNPACKED_BYTES + 1));
    let mut extracted = std::collections::HashSet::new();
    for entry in archive.entries().map_err(|_| ComputerError::Integrity)? {
        let mut member = entry.map_err(|_| ComputerError::Integrity)?;
        // The binary tarball is flat. Never unpack archive-controlled paths or links.
        let path = member.path_bytes();
        let name = asset
            .files
            .iter()
            .copied()
            .find(|name| name.as_bytes() == path.as_ref())
            .ok_or(ComputerError::Integrity)?;
        if member.header().entry_type() != tar::EntryType::Regular || !extracted.insert(name) {
            return Err(ComputerError::Integrity);
        }
        let size = member.size();
        write_member(&mut member, size, &destination.join(name))?;
    }
    if extracted.len() != asset.files.len() {
        return Err(ComputerError::Integrity);
    }
    Ok(())
}

fn write_member(reader: &mut impl Read, size: u64, path: &Path) -> Result<()> {
    if size > MAX_FILE_BYTES {
        return Err(ComputerError::Integrity);
    }
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|_| ComputerError::Storage)?;
    let copied = std::io::copy(&mut reader.take(MAX_FILE_BYTES + 1), &mut file)
        .map_err(|_| ComputerError::Integrity)?;
    if copied != size {
        return Err(ComputerError::Integrity);
    }
    if path.extension().is_none() {
        platform::set_executable(path)?;
    }
    Ok(())
}

#[cfg(test)]
#[path = "archive_tests.rs"]
mod tests;
