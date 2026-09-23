//! Resolve the current stable CLI version independently of installed CLI and model caches.
use std::{path::Path, time::Duration};

use reqwest::blocking::Client;
use semver::Version;
use serde::Deserialize;

use crate::storage::{read_json, Paths};

pub(crate) const MIN_CODEX_MODEL_CLIENT_VERSION: &str = "0.152.0";
const LATEST_CODEX_RELEASE_URL: &str = "https://registry.npmjs.org/@openai/codex/latest";
const RELEASE_LOOKUP_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug, thiserror::Error)]
enum ReleaseLookupError {
    #[error("Codex CLI release lookup failed")]
    Request(#[from] reqwest::Error),
    #[error("Codex CLI release does not contain a stable version")]
    InvalidVersion,
}

#[derive(Deserialize)]
struct CodexRelease {
    version: String,
}

/// Performs a fresh release lookup for each model refresh; call only on a blocking worker.
pub(crate) fn model_client_version(paths: &Paths) -> String {
    let client = crate::system_proxy::apply(Client::builder())
        .user_agent("Codex-Switch")
        .timeout(RELEASE_LOOKUP_TIMEOUT)
        .build();
    resolve_model_client_version(paths, || {
        fetch_latest_version(&client?, LATEST_CODEX_RELEASE_URL)
    })
}

fn fetch_latest_version(client: &Client, endpoint: &str) -> Result<Version, ReleaseLookupError> {
    let release: CodexRelease = client
        .get(endpoint)
        .header(reqwest::header::CACHE_CONTROL, "no-cache")
        .send()?
        .error_for_status()?
        .json()?;
    stable_version(&release.version).ok_or(ReleaseLookupError::InvalidVersion)
}

fn resolve_model_client_version(
    paths: &Paths,
    lookup: impl FnOnce() -> Result<Version, ReleaseLookupError>,
) -> String {
    let latest = match lookup() {
        Ok(version) => Some(version),
        Err(error) => {
            eprintln!("{error}; using the latest locally known model client version");
            None
        }
    };
    // Include Switch's successful response so an older CLI cache cannot undo an online refresh.
    [
        latest,
        cached_version(&super::cache_path(paths)),
        cached_version(&paths.codex_home.join("models_cache.json")),
        stable_version(MIN_CODEX_MODEL_CLIENT_VERSION),
    ]
    .into_iter()
    .flatten()
    .max()
    .map(|version| version.to_string())
    .unwrap_or_else(|| MIN_CODEX_MODEL_CLIENT_VERSION.to_string())
}

fn cached_version(path: &Path) -> Option<Version> {
    let value = read_json(path).ok()?;
    stable_version(value.get("client_version")?.as_str()?)
}

fn stable_version(value: &str) -> Option<Version> {
    let mut version = Version::parse(value).ok()?;
    if !version.pre.is_empty() {
        return None;
    }
    version.build = semver::BuildMetadata::EMPTY;
    Some(version)
}

#[cfg(test)]
#[path = "client_version_tests.rs"]
mod tests;
