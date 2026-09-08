use super::error::{GuiError, Result};
#[cfg(test)]
#[path = "release_tests.rs"]
mod tests;
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager};

const RELEASE_API: &str = "https://api.github.com/repos/openai/codex/releases";
const MAX_DOWNLOAD: u64 = 512 * 1024 * 1024;
static INSTALL_LOCK: Mutex<()> = Mutex::new(());

#[derive(Deserialize)]
struct Release {
    tag_name: String,
    assets: Vec<Asset>,
}
#[derive(Deserialize)]
struct Asset {
    name: String,
    browser_download_url: String,
    size: u64,
    digest: Option<String>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Installed {
    pub(crate) version: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReleaseInfo {
    version: String,
    size: u64,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress {
    downloaded: u64,
    total: u64,
    phase: &'static str,
}

pub(super) fn root(app: &AppHandle) -> Result<PathBuf> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|_| GuiError::Startup)?
        .join("codex-cli"))
}

fn valid_version(version: &str) -> bool {
    version.len() < 80 && semver::Version::parse(version).is_ok()
}

pub(super) fn installed(app: &AppHandle) -> Result<Installed> {
    let root = root(app)?;
    let content = match fs::read_to_string(root.join("installed.json")) {
        Ok(content) => content,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(Installed { version: None })
        }
        Err(_) => return Err(GuiError::Startup),
    };
    let installed: Installed = serde_json::from_str(&content).map_err(|_| GuiError::Startup)?;
    let version = installed.version.filter(|version| {
        valid_version(version) && root.join(version).join(entrypoint()).is_file()
    });
    Ok(Installed { version })
}

pub(super) fn executable(app: &AppHandle) -> Result<PathBuf> {
    let version = installed(app)?.version.ok_or(GuiError::Executable)?;
    Ok(root(app)?.join(version).join(entrypoint()))
}

fn entrypoint() -> &'static str {
    if cfg!(windows) {
        "bin/codex.exe"
    } else {
        "bin/codex"
    }
}

fn asset_name() -> Result<String> {
    let arch = match std::env::consts::ARCH {
        "x86_64" => "x86_64",
        "aarch64" => "aarch64",
        _ => return Err(GuiError::Release),
    };
    let platform = match std::env::consts::OS {
        "windows" => "pc-windows-msvc",
        "macos" => "apple-darwin",
        "linux" => "unknown-linux-musl",
        _ => return Err(GuiError::Release),
    };
    Ok(format!("codex-package-{arch}-{platform}.tar.gz"))
}

fn http_client() -> Result<Client> {
    crate::system_proxy::apply(Client::builder())
        .user_agent("Codex-Switch-GUI")
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|_| GuiError::Release)
}

fn release(client: &Client, version: Option<&str>) -> Result<(String, Asset)> {
    let endpoint = if let Some(version) = version {
        if !valid_version(version) {
            return Err(GuiError::InvalidRequest);
        }
        format!("{RELEASE_API}/tags/rust-v{version}")
    } else {
        format!("{RELEASE_API}/latest")
    };
    let release: Release = client
        .get(endpoint)
        .timeout(Duration::from_secs(25))
        .send()
        .and_then(|response| response.error_for_status())
        .and_then(|response| response.json())
        .map_err(|_| GuiError::Release)?;
    let version = release
        .tag_name
        .strip_prefix("rust-v")
        .filter(|version| valid_version(version))
        .ok_or(GuiError::Release)?
        .to_owned();
    let name = asset_name()?;
    let asset = release
        .assets
        .into_iter()
        .find(|asset| asset.name == name)
        .ok_or(GuiError::Release)?;
    let expected_url =
        format!("https://github.com/openai/codex/releases/download/rust-v{version}/{name}");
    if asset.browser_download_url != expected_url || asset.size > MAX_DOWNLOAD {
        return Err(GuiError::Release);
    }
    Ok((version, asset))
}

fn publish(app: &AppHandle, progress: Progress) {
    if app.emit_to("main", "codex-gui-download", progress).is_err() {
        eprintln!("Codex GUI could not publish download progress");
    }
}

fn download(
    progress: impl Fn(Progress),
    client: &Client,
    asset: &Asset,
    path: &Path,
) -> Result<()> {
    let expected = asset
        .digest
        .as_deref()
        .and_then(|value| value.strip_prefix("sha256:"))
        .filter(|value| value.len() == 64)
        .ok_or(GuiError::Integrity)?;
    let mut response = client
        .get(&asset.browser_download_url)
        .send()
        .and_then(|response| response.error_for_status())
        .map_err(|_| GuiError::Release)?;
    let mut file = fs::File::create(path).map_err(|_| GuiError::Install)?;
    let mut hash = Sha256::new();
    let mut buffer = vec![0u8; 256 * 1024];
    let mut downloaded = 0;
    let mut last_percent = 0;
    loop {
        let count = response.read(&mut buffer).map_err(|_| GuiError::Release)?;
        if count == 0 {
            break;
        }
        downloaded += count as u64;
        if downloaded > asset.size || downloaded > MAX_DOWNLOAD {
            return Err(GuiError::Integrity);
        }
        hash.update(&buffer[..count]);
        file.write_all(&buffer[..count])
            .map_err(|_| GuiError::Install)?;
        let percent = downloaded * 100 / asset.size.max(1);
        if percent > last_percent {
            progress(Progress {
                downloaded,
                total: asset.size,
                phase: "downloading",
            });
            last_percent = percent;
        }
    }
    if downloaded != asset.size || format!("{:x}", hash.finalize()) != expected {
        return Err(GuiError::Integrity);
    }
    Ok(())
}

pub(super) fn unpack(archive: &Path, destination: &Path) -> Result<()> {
    let file = fs::File::open(archive).map_err(|_| GuiError::Install)?;
    let mut archive = tar::Archive::new(flate2::read::GzDecoder::new(file));
    let mut total = 0u64;
    for entry in archive.entries().map_err(|_| GuiError::Install)? {
        let mut entry = entry.map_err(|_| GuiError::Install)?;
        let kind = entry.header().entry_type();
        if !kind.is_file() && !kind.is_dir() {
            return Err(GuiError::Integrity);
        }
        total = total.checked_add(entry.size()).ok_or(GuiError::Integrity)?;
        if total > MAX_DOWNLOAD * 4 {
            return Err(GuiError::Integrity);
        }
        if !entry
            .unpack_in(destination)
            .map_err(|_| GuiError::Install)?
        {
            return Err(GuiError::Integrity);
        }
    }
    if !destination.join(entrypoint()).is_file() {
        return Err(GuiError::Install);
    }
    Ok(())
}

fn install(app: &AppHandle, version: String) -> Result<Installed> {
    let _guard = INSTALL_LOCK.try_lock().map_err(|_| GuiError::Installing)?;
    let client = http_client()?;
    let (version, asset) = release(&client, Some(&version))?;
    let root = root(app)?;
    fs::create_dir_all(&root).map_err(|_| GuiError::Install)?;
    let archive = root.join(format!("download-{}.tar.gz", uuid::Uuid::new_v4()));
    let staging = root.join(format!("staging-{}", uuid::Uuid::new_v4()));
    let outcome = (|| {
        download(|progress| publish(app, progress), &client, &asset, &archive)?;
        publish(
            app,
            Progress {
                downloaded: asset.size,
                total: asset.size,
                phase: "installing",
            },
        );
        fs::create_dir(&staging).map_err(|_| GuiError::Install)?;
        unpack(&archive, &staging)?;
        let destination = root.join(&version);
        if !destination.exists() {
            fs::rename(&staging, destination).map_err(|_| GuiError::Install)?;
        }
        let installed = Installed {
            version: Some(version),
        };
        crate::storage::write_json_atomic(
            &root.join("installed.json"),
            &serde_json::json!(installed),
        )
        .map_err(|_| GuiError::Install)?;
        Ok(installed)
    })();
    // These paths are generated children of the verified installation root, never frontend input.
    if archive.is_file() && fs::remove_file(&archive).is_err() {
        eprintln!("Codex GUI download cleanup failed");
    }
    if staging.is_dir()
        && staging.parent() == Some(root.as_path())
        && fs::remove_dir_all(&staging).is_err()
    {
        eprintln!("Codex GUI staging cleanup failed");
    }
    outcome
}

#[tauri::command]
pub(crate) async fn codex_gui_cli_status(app: AppHandle) -> std::result::Result<Installed, String> {
    tauri::async_runtime::spawn_blocking(move || installed(&app))
        .await
        .map_err(|_| GuiError::Startup.to_string())?
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn codex_gui_cli_release() -> std::result::Result<ReleaseInfo, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let (version, asset) = release(&http_client()?, None)?;
        Ok(ReleaseInfo {
            version,
            size: asset.size,
        })
    })
    .await
    .map_err(|_| GuiError::Release.to_string())?
    .map_err(|error: GuiError| error.to_string())
}

#[tauri::command]
pub(crate) async fn codex_gui_cli_install(
    app: AppHandle,
    version: String,
) -> std::result::Result<Installed, String> {
    tauri::async_runtime::spawn_blocking(move || install(&app, version))
        .await
        .map_err(|_| GuiError::Install.to_string())?
        .map_err(|error| error.to_string())
}
