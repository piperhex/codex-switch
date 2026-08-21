use std::{
    fs::{self, File},
    io::{Cursor, Read, Write},
    path::{Path, PathBuf},
};

use aes_gcm::{
    aead::{Aead, Payload},
    Aes256Gcm, KeyInit, Nonce,
};
use chrono::Utc;
use flate2::{read::GzDecoder, write::GzEncoder, Compression};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{Emitter, Runtime};
use zip::{write::SimpleFileOptions, CompressionMethod, ZipArchive, ZipWriter};

use crate::{
    auth::{account_fields, canonicalize_chatgpt_auth, validate_auth},
    models::{AccountPrivateDetails, ProviderProfile, ProviderSyncPayload, UsageSummary},
    storage::{
        account_private_details_path, auto_switch_priority_path, expiration_path,
        load_account_private_details, load_auto_switch_priority, load_expiration, load_note,
        load_or_init_last_modified, load_usage, managed_auth_path, note_path, parse_last_modified,
        read_json, read_state, resolve_paths, save_account_last_modified,
        save_account_private_details, save_auto_switch_priority, save_expiration, save_note,
        save_usage, usage_path, write_json_if_changed, write_managed_auth_if_changed, write_state,
    },
};

const ARCHIVE_PAYLOAD_FILE: &str = "accounts.payload";
const ARCHIVE_MAGIC: &[u8] = b"CSARCHIVE1";
const ARCHIVE_KEY: [u8; 32] = *b"CodexSwitchLocalBackupKeyV1!2026";
const NONCE_LENGTH: usize = 12;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AccountArchivePayload {
    format_version: u16,
    exported_at: String,
    active_account_id: Option<String>,
    #[serde(default)]
    active_provider_id: Option<String>,
    accounts: Vec<AccountArchiveEntry>,
    #[serde(default)]
    providers: Vec<ProviderSyncPayload>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AccountArchiveEntry {
    id: String,
    auth: Value,
    note: String,
    expires_at: String,
    #[serde(default)]
    private_details: AccountPrivateDetails,
    usage: UsageSummary,
    #[serde(default)]
    auto_switch_priority: i32,
    #[serde(default)]
    last_modified_at: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AccountArchiveImportResult {
    imported: usize,
    account_ids: Vec<String>,
    active_account_id: Option<String>,
    providers_imported: usize,
    provider_ids: Vec<String>,
    active_provider_id: Option<String>,
}

#[tauri::command]
pub(crate) fn export_accounts_archive<R: Runtime>(
    app: tauri::AppHandle<R>,
    path: String,
) -> Result<String, String> {
    let payload = collect_accounts(&app)?;
    if payload.accounts.is_empty() && payload.providers.is_empty() {
        return Err("No local accounts or providers to export".to_string());
    }

    let output_path = normalize_archive_path(Path::new(&path));
    let archive = encode_archive(&payload)?;
    if let Some(parent) = output_path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create {}: {error}", parent.display()))?;
    }
    fs::write(&output_path, archive)
        .map_err(|error| format!("Failed to write {}: {error}", output_path.display()))?;
    Ok(output_path.display().to_string())
}

#[tauri::command]
pub(crate) fn import_accounts_archive<R: Runtime>(
    app: tauri::AppHandle<R>,
    path: String,
) -> Result<AccountArchiveImportResult, String> {
    let payload = decode_archive(Path::new(&path))?;
    let result = apply_archive(&app, payload)?;
    if !result.account_ids.is_empty() {
        app.emit("accounts-changed", ())
            .map_err(|error| error.to_string())?;
    }
    if !result.provider_ids.is_empty() {
        app.emit("providers-changed", ())
            .map_err(|error| error.to_string())?;
        if let Ok(paths) = resolve_paths(&app) {
            crate::providers::refresh_codex_models_for_current_target(&paths);
        }
    }
    crate::system_tray::refresh_menu(&app);
    Ok(result)
}
