//! Pinned upstream packages; macOS uses the host-attributed direct runtime.
use super::{ComputerError, Result};

#[derive(Clone, Copy)]
pub(super) enum ArchiveFormat {
    Zip,
    TarGz,
}

pub(super) struct Asset {
    pub target: &'static str,
    pub suffix: &'static str,
    pub digest: &'static str,
    pub format: ArchiveFormat,
    pub files: &'static [&'static str],
}

const WINDOWS_FILES: &[&str] = &[
    "cua-driver.exe",
    "cua-driver-uia.exe",
    "cua-cursor-theme.exe",
    "cua_driver_sdk.dll",
    "cua_driver_node_runtime.node",
    "cua_driver_abi.h",
];
const MACOS_FILES: &[&str] = &[
    "cua-driver",
    "cua-cursor-theme",
    "libcua_driver_sdk.dylib",
    "cua_driver_node_runtime.node",
    "cua_driver_abi.h",
];

impl Asset {
    pub fn executable(&self) -> &'static str {
        self.files[0]
    }
}

pub(super) fn select(os: &str, architecture: &str) -> Result<Asset> {
    let (target, digest) = match (os, architecture) {
        ("macos", "x86_64" | "aarch64") => {
            return Ok(Asset {
                target: "darwin-universal",
                suffix: "-binary.tar.gz",
                digest: "29984f5363c12d9901588e814a3a519b8015a1255d7a59d658fbf2d3e51f8983",
                format: ArchiveFormat::TarGz,
                files: MACOS_FILES,
            })
        }
        ("windows", "x86_64") => (
            "windows-x86_64",
            "4ea967b72209aefa8c25126feaedaba662b8bee8cdec01f69b2ff2b19d3781e7",
        ),
        ("windows", "aarch64") => (
            "windows-arm64",
            "3785beda0735bf80904ab373cd745565cbd5e79a675675916fa137a13b5b0914",
        ),
        _ => return Err(ComputerError::Unsupported),
    };
    Ok(Asset {
        target,
        digest,
        suffix: ".zip",
        format: ArchiveFormat::Zip,
        files: WINDOWS_FILES,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn selects_native_packages_without_changing_windows_cache_paths() {
        for architecture in ["aarch64", "x86_64"] {
            let mac = select("macos", architecture).unwrap();
            assert_eq!(mac.target, "darwin-universal");
            assert_eq!(mac.suffix, "-binary.tar.gz");
            assert_eq!(mac.executable(), "cua-driver");
            let windows = select("windows", architecture).unwrap();
            assert_eq!(windows.executable(), "cua-driver.exe");
            assert!(windows.target.starts_with("windows-"));
        }
        assert!(select("linux", "x86_64").is_err());
        assert!(select("macos", "x86").is_err());
    }
}
