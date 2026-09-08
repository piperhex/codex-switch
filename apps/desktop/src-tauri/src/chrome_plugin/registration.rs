use super::{BrowserError, Result, EXTENSION_ID, HOST_NAME};
use serde_json::json;
use std::{
    fs,
    path::{Path, PathBuf},
};

fn manifest(root: &Path) -> PathBuf {
    root.join(format!("{HOST_NAME}.json"))
}

pub(super) fn register(root: &Path, executable: &Path) -> Result<()> {
    let path = manifest(root);
    let content = json!({"name":HOST_NAME,"description":"Codex Switch browser assistant",
        "path":executable,"type":"stdio","allowed_origins":[format!("chrome-extension://{}/",EXTENSION_ID.trim())]});
    crate::storage::write_json_atomic(&path, &content).map_err(|_| BrowserError::Storage)?;
    platform::register(&path)
}

pub(super) fn unregister(root: &Path) -> Result<()> {
    let path = manifest(root);
    platform::unregister(&path)?;
    if path.exists() {
        fs::remove_file(path).map_err(|_| BrowserError::Storage)?;
    }
    Ok(())
}

pub(super) fn supported() -> bool {
    cfg!(any(windows, target_os = "macos", target_os = "linux"))
}

pub(super) fn open_extensions() -> Result<()> {
    platform::open_extensions()
}

#[cfg(windows)]
mod platform {
    use super::*;
    use winreg::{enums::HKEY_CURRENT_USER, RegKey};
    fn key() -> String {
        format!("Software\\Google\\Chrome\\NativeMessagingHosts\\{HOST_NAME}")
    }
    pub(super) fn open_extensions() -> Result<()> {
        use std::os::windows::process::CommandExt;
        let executable = ["PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA"]
            .into_iter()
            .filter_map(std::env::var_os)
            .map(PathBuf::from)
            .map(|path| path.join("Google/Chrome/Application/chrome.exe"))
            .find(|path| path.is_file())
            .ok_or(BrowserError::Disconnected)?;
        std::process::Command::new(executable)
            .arg("chrome://extensions/")
            .creation_flags(0x0800_0000)
            .spawn()
            .map(|_| ())
            .map_err(|_| BrowserError::Storage)
    }
    pub(super) fn register(path: &Path) -> Result<()> {
        let root = RegKey::predef(HKEY_CURRENT_USER);
        let (key, _) = root
            .create_subkey(key())
            .map_err(|_| BrowserError::Storage)?;
        key.set_value("", &path.to_string_lossy().as_ref())
            .map_err(|_| BrowserError::Storage)
    }
    pub(super) fn unregister(path: &Path) -> Result<()> {
        let root = RegKey::predef(HKEY_CURRENT_USER);
        let Ok(existing) = root.open_subkey(key()) else {
            return Ok(());
        };
        let value: String = existing.get_value("").map_err(|_| BrowserError::Storage)?;
        if Path::new(&value) == path {
            root.delete_subkey(key())
                .map_err(|_| BrowserError::Storage)?;
        }
        Ok(())
    }
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
mod platform {
    use super::*;
    fn destination() -> Result<PathBuf> {
        let home = dirs::home_dir().ok_or(BrowserError::Storage)?;
        let folder = if cfg!(target_os = "macos") {
            "Library/Application Support/Google/Chrome/NativeMessagingHosts"
        } else {
            ".config/google-chrome/NativeMessagingHosts"
        };
        Ok(home.join(folder).join(format!("{HOST_NAME}.json")))
    }
    pub(super) fn open_extensions() -> Result<()> {
        let mut command = if cfg!(target_os = "macos") {
            let mut command = std::process::Command::new("open");
            command.args(["-a", "Google Chrome"]);
            command
        } else {
            std::process::Command::new("google-chrome")
        };
        command
            .arg("chrome://extensions/")
            .spawn()
            .map(|_| ())
            .map_err(|_| BrowserError::Storage)
    }
    pub(super) fn register(path: &Path) -> Result<()> {
        let destination = destination()?;
        fs::create_dir_all(destination.parent().ok_or(BrowserError::Storage)?)
            .map_err(|_| BrowserError::Storage)?;
        fs::copy(path, destination)
            .map(|_| ())
            .map_err(|_| BrowserError::Storage)
    }
    pub(super) fn unregister(path: &Path) -> Result<()> {
        let destination = destination()?;
        if destination.exists() && fs::read(&destination).ok() == fs::read(path).ok() {
            fs::remove_file(destination).map_err(|_| BrowserError::Storage)?;
        }
        Ok(())
    }
}

#[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
mod platform {
    use super::*;
    pub(super) fn register(_: &Path) -> Result<()> {
        Err(BrowserError::Unsupported)
    }
    pub(super) fn unregister(_: &Path) -> Result<()> {
        Err(BrowserError::Unsupported)
    }
    pub(super) fn open_extensions() -> Result<()> {
        Err(BrowserError::Unsupported)
    }
}
