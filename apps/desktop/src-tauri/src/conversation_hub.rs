use std::{
    collections::{HashMap, HashSet},
    fs::{self, File},
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

use chrono::{DateTime, Utc};
use rusqlite::{params, params_from_iter, types::Value as SqlValue, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::{Manager, Runtime};
use tauri_plugin_opener::OpenerExt;
use uuid::Uuid;
use zip::{write::SimpleFileOptions, CompressionMethod, ZipArchive, ZipWriter};

use crate::storage::{replace_file, resolve_paths, write_text_atomic};

const INDEX_NAME: &str = "session_index.jsonl";
const ROLLOUT_FOLDERS: [&str; 2] = ["sessions", "archived_sessions"];
const BUNDLE_KIND: &str = "codex-session-export";
const BUNDLE_REVISION: u32 = 1;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ThreadEntry {
    session_id: String,
    session_kind: String,
    title: String,
    cwd: String,
    updated_at: Option<i64>,
    size_bytes: u64,
    match_excerpt: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ThreadTokenTotals {
    session_id: String,
    input_tokens: u64,
    output_tokens: u64,
    total_tokens: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MutationReport {
    requested_count: usize,
    affected_count: usize,
    released_bytes: u64,
    message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BinEntry {
    session_id: String,
    title: String,
    cwd: String,
    deleted_at: Option<i64>,
    size_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BundlePreview {
    package_version: u32,
    exported_at: Option<String>,
    total_count: usize,
    ready_count: usize,
    total_size_bytes: u64,
    items: Vec<BundlePreviewItem>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BundlePreviewItem {
    session_id: String,
    title: String,
    cwd: String,
    updated_at: Option<i64>,
    size_bytes: u64,
    status: String,
    reason: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BundleResult {
    requested_count: usize,
    completed_count: usize,
    skipped_count: usize,
    path: String,
    message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VisibilityReport {
    mode: String,
    scanned_count: usize,
    rollout_count: usize,
    database_row_count: usize,
    catalog_row_count: usize,
    index_entry_count: usize,
    backup_dir: Option<String>,
    dry_run: bool,
    message: String,
}

#[derive(Debug, Clone)]
struct RolloutSnapshot {
    session_id: String,
    title: String,
    cwd: String,
    updated_at: Option<i64>,
    path: PathBuf,
    physical_paths: Vec<PathBuf>,
    relative_path: PathBuf,
    index_value: Value,
    size_bytes: u64,
    history_base_thread_id: Option<String>,
    parent_thread_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PackageManifest {
    kind: String,
    package_version: u32,
    exported_at: String,
    sessions: Vec<PackageItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PackageItem {
    session_id: String,
    title: String,
    cwd: String,
    updated_at: Option<i64>,
    relative_rollout_path: String,
    file_entry: String,
    size_bytes: u64,
    sha256: String,
    session_index_entry: Value,
    #[serde(default)]
    source_instance: Option<Value>,
    #[serde(default)]
    state_row: Option<SqliteRowSnapshot>,
    #[serde(default)]
    related_state: Vec<SqliteTableSnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SqliteRowSnapshot {
    columns: Vec<String>,
    values: Vec<SqliteCell>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SqliteTableSnapshot {
    database: String,
    table: String,
    rows: Vec<SqliteRowSnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "value", rename_all = "snake_case")]
enum SqliteCell {
    Null,
    Integer(i64),
    Real(f64),
    Text(String),
    Blob(Vec<u8>),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BinManifest {
    session_id: String,
    title: String,
    cwd: String,
    original_rollout_path: PathBuf,
    relative_rollout_path: String,
    session_index_entry: Value,
    deleted_at: String,
    #[serde(default)]
    state_visibility: Option<StateVisibilitySnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StateVisibilitySnapshot {
    rollout_path: String,
    archived: i64,
    archived_at: Option<i64>,
    preview: String,
}

#[derive(Debug, Clone)]
struct BinSnapshot {
    folder: PathBuf,
    manifest: BinManifest,
    rollouts: Vec<PathBuf>,
}

fn normalized_ids(values: Vec<String>) -> HashSet<String> {
    values
        .into_iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect()
}

fn index_values(codex_home: &Path) -> Result<HashMap<String, Value>, String> {
    let path = codex_home.join(INDEX_NAME);
    if !path.exists() {
        return Ok(HashMap::new());
    }
    let content = fs::read_to_string(&path)
        .map_err(|error| format!("无法读取会话索引 {}：{error}", path.display()))?;
    let mut result = HashMap::new();
    for line in content.lines() {
        let Ok(value) = serde_json::from_str::<Value>(line.trim()) else {
            continue;
        };
        if let Some(id) = value.get("id").and_then(Value::as_str) {
            result.insert(id.to_string(), value);
        }
    }
    Ok(result)
}

fn title_from_index(value: &Value) -> Option<String> {
    ["thread_name", "threadName", "title", "name"]
        .into_iter()
        .filter_map(|key| value.get(key).and_then(Value::as_str))
        .map(str::trim)
        .find(|value| !value.is_empty())
        .map(str::to_string)
}

fn unix_seconds(value: &Value) -> Option<i64> {
    if let Some(number) = value.as_i64() {
        return Some(if number > 10_000_000_000 {
            number / 1000
        } else {
            number
        });
    }
    let text = value.as_str()?.trim();
    if let Ok(number) = text.parse::<i64>() {
        return Some(if number > 10_000_000_000 {
            number / 1000
        } else {
            number
        });
    }
    DateTime::parse_from_rfc3339(text)
        .ok()
        .map(|date| date.timestamp())
}

fn modified_seconds(path: &Path) -> Option<i64> {
    fs::metadata(path)
        .ok()?
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_secs() as i64)
}

fn index_timestamp(value: Option<&Value>) -> Option<i64> {
    let value = value?;
    [
        "updated_at",
        "updatedAt",
        "last_updated_at",
        "lastUpdatedAt",
    ]
    .into_iter()
    .filter_map(|key| value.get(key))
    .find_map(unix_seconds)
}

fn compressed_rollout_path(path: &Path) -> PathBuf {
    path.with_extension("jsonl.zst")
}

fn logical_rollout_path(path: &Path) -> Option<PathBuf> {
    let name = path.file_name()?.to_str()?;
    if name.starts_with("rollout-") && name.ends_with(".jsonl") {
        return Some(path.to_path_buf());
    }
    if name.starts_with("rollout-") && name.ends_with(".jsonl.zst") {
        return Some(path.with_file_name(name.trim_end_matches(".zst")));
    }
    None
}

fn rollout_physical_paths(logical_path: &Path) -> Vec<PathBuf> {
    [
        logical_path.to_path_buf(),
        compressed_rollout_path(logical_path),
    ]
    .into_iter()
    .filter(|path| path.is_file())
    .collect()
}

fn preferred_rollout_path(logical_path: &Path) -> Option<PathBuf> {
    logical_path
        .is_file()
        .then(|| logical_path.to_path_buf())
        .or_else(|| {
            let compressed = compressed_rollout_path(logical_path);
            compressed.is_file().then_some(compressed)
        })
}

fn rollout_reader(path: &Path) -> Result<Box<dyn BufRead>, String> {
    let file = File::open(path)
        .map_err(|error| format!("无法打开会话文件 {}：{error}", path.display()))?;
    if path.extension().and_then(|value| value.to_str()) == Some("zst") {
        let decoder = zstd::stream::read::Decoder::new(file)
            .map_err(|error| format!("无法解压会话文件 {}：{error}", path.display()))?;
        Ok(Box::new(BufReader::new(decoder)))
    } else {
        Ok(Box::new(BufReader::new(file)))
    }
}

fn collect_rollout_paths(root: &Path, result: &mut Vec<PathBuf>) -> Result<(), String> {
    if !root.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(root)
        .map_err(|error| format!("无法读取会话目录 {}：{error}", root.display()))?
    {
        let entry = entry.map_err(|error| format!("无法读取会话目录项：{error}"))?;
        let path = entry.path();
        if entry
            .file_type()
            .map_err(|error| error.to_string())?
            .is_dir()
        {
            collect_rollout_paths(&path, result)?;
        } else if let Some(logical) = logical_rollout_path(&path) {
            result.push(logical);
        }
    }
    Ok(())
}

fn first_rollout_value(path: &Path) -> Result<Option<Value>, String> {
    for line in rollout_reader(path)?.lines() {
        let line = line.map_err(|error| format!("无法读取会话文件 {}：{error}", path.display()))?;
        if line.trim().is_empty() {
            continue;
        }
        let Ok(value) = serde_json::from_str::<Value>(line.trim()) else {
            return Ok(None);
        };
        return Ok(
            (value.get("type").and_then(Value::as_str) == Some("session_meta")).then_some(value),
        );
    }
    Ok(None)
}

fn snapshot_id(meta: &Value) -> Option<String> {
    meta.pointer("/payload/id")
        .or_else(|| meta.pointer("/payload/session_id"))
        .or_else(|| meta.get("id"))
        .or_else(|| meta.get("session_id"))
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn snapshot_cwd(meta: &Value) -> Option<String> {
    meta.pointer("/payload/cwd")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn snapshot_reference_id(meta: &Value, field: &str) -> Option<String> {
    meta.pointer(&format!("/payload/{field}/thread_id"))
        .or_else(|| meta.pointer(&format!("/payload/{field}/threadId")))
        .or_else(|| meta.pointer(&format!("/payload/{field}")))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn gather_snapshots(codex_home: &Path) -> Result<Vec<RolloutSnapshot>, String> {
    let index = index_values(codex_home)?;
    let mut files = Vec::new();
    for folder in ROLLOUT_FOLDERS {
        collect_rollout_paths(&codex_home.join(folder), &mut files)?;
    }
    files.sort();
    files.dedup();
    let mut snapshots = Vec::new();
    for logical_path in files {
        let Some(path) = preferred_rollout_path(&logical_path) else {
            continue;
        };
        let physical_paths = rollout_physical_paths(&logical_path);
        let Some(meta) = first_rollout_value(&path)? else {
            continue;
        };
        let Some(session_id) = snapshot_id(&meta) else {
            continue;
        };
        let indexed = index.get(&session_id);
        let title = indexed
            .and_then(title_from_index)
            .unwrap_or_else(|| session_id.clone());
        let cwd = snapshot_cwd(&meta).unwrap_or_else(|| "未知工作目录".to_string());
        let updated_at = index_timestamp(indexed).or_else(|| modified_seconds(&path));
        let relative_path = path.strip_prefix(codex_home).unwrap_or(&path).to_path_buf();
        let index_value = indexed
            .cloned()
            .unwrap_or_else(|| json!({ "id": session_id, "thread_name": title }));
        let size_bytes = physical_paths
            .iter()
            .filter_map(|path| fs::metadata(path).ok())
            .map(|item| item.len())
            .sum();
        let history_base_thread_id = snapshot_reference_id(&meta, "history_base");
        let parent_thread_id = snapshot_reference_id(&meta, "parent_thread_id")
            .or_else(|| snapshot_reference_id(&meta, "parent_thread"));
        snapshots.push(RolloutSnapshot {
            session_id,
            title,
            cwd,
            updated_at,
            path,
            physical_paths,
            relative_path,
            index_value,
            size_bytes,
            history_base_thread_id,
            parent_thread_id,
        });
    }
    Ok(snapshots)
}

fn thread_kind(title: &str, cwd: &str) -> String {
    let text = format!("{title} {cwd}").to_ascii_lowercase();
    if text.contains("subagent") || text.contains("sub-agent") || text.contains("agent run") {
        "subagent".to_string()
    } else if text.contains("external") || text.contains("imported") || text.contains("cli run") {
        "external".to_string()
    } else {
        "conversation".to_string()
    }
}

fn clipped_match(value: &str, needle: &str) -> Option<String> {
    let normalized = value.split_whitespace().collect::<Vec<_>>().join(" ");
    let lowered = normalized.to_lowercase();
    let lowered_needle = needle.to_lowercase();
    let hit = lowered.find(&lowered_needle)?;
    let hit_chars = lowered[..hit].chars().count();
    let start = hit_chars.saturating_sub(48);
    let take = lowered_needle.chars().count().saturating_add(112);
    let total_chars = normalized.chars().count();
    let body = normalized
        .chars()
        .skip(start)
        .take(take)
        .collect::<String>();
    Some(format!(
        "{}{}{}",
        if start > 0 { "…" } else { "" },
        body,
        if start.saturating_add(take) < total_chars {
            "…"
        } else {
            ""
        }
    ))
}

fn matching_json_text(value: &Value, needle: &str) -> Option<String> {
    match value {
        Value::String(text) => clipped_match(text, needle),
        Value::Array(values) => values
            .iter()
            .find_map(|value| matching_json_text(value, needle)),
        Value::Object(values) => {
            for key in ["content", "text", "message", "input", "output"] {
                if let Some(found) = values
                    .get(key)
                    .and_then(|value| matching_json_text(value, needle))
                {
                    return Some(found);
                }
            }
            values
                .values()
                .find_map(|value| matching_json_text(value, needle))
        }
        _ => None,
    }
}

fn locate_rollout_text(path: &Path, needle: &str) -> Result<Option<String>, String> {
    for line in rollout_reader(path)?.lines() {
        let line = line.map_err(|error| format!("无法搜索会话文件 {}：{error}", path.display()))?;
        let Ok(value) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        if value.get("type").and_then(Value::as_str) == Some("session_meta") {
            continue;
        }
        if let Some(found) = matching_json_text(&value, needle) {
            return Ok(Some(found));
        }
    }
    Ok(None)
}

pub(crate) fn browse_codex_threads_blocking<R: Runtime>(
    app: tauri::AppHandle<R>,
    title_query: Option<String>,
    content_query: Option<String>,
) -> Result<Vec<ThreadEntry>, String> {
    let codex_home = resolve_paths(&app)?.codex_home;
    let title_query = title_query
        .map(|value| value.trim().to_lowercase())
        .filter(|v| !v.is_empty());
    let content_query = content_query
        .map(|value| value.trim().to_string())
        .filter(|v| !v.is_empty());
    let mut entries = Vec::new();
    for snapshot in gather_snapshots(&codex_home)? {
        let title_matches = title_query
            .as_ref()
            .is_some_and(|query| snapshot.title.to_lowercase().contains(query));
        let match_excerpt = match content_query.as_deref() {
            Some(_) if title_query.is_some() && title_matches => None,
            Some(query) => locate_rollout_text(&snapshot.path, query)?,
            None => None,
        };
        let matches = match (title_query.is_some(), content_query.is_some()) {
            (true, true) => title_matches || match_excerpt.is_some(),
            (true, false) => title_matches,
            (false, true) => match_excerpt.is_some(),
            (false, false) => true,
        };
        if !matches {
            continue;
        }
        entries.push(ThreadEntry {
            session_id: snapshot.session_id,
            session_kind: thread_kind(&snapshot.title, &snapshot.cwd),
            title: snapshot.title,
            cwd: snapshot.cwd,
            updated_at: snapshot.updated_at,
            size_bytes: snapshot.size_bytes,
            match_excerpt,
        });
    }
    entries.sort_by(|left, right| {
        right
            .updated_at
            .unwrap_or_default()
            .cmp(&left.updated_at.unwrap_or_default())
            .then_with(|| left.cwd.cmp(&right.cwd))
            .then_with(|| left.title.cmp(&right.title))
    });
    Ok(entries)
}

fn token_totals(path: &Path) -> Option<(u64, u64, u64)> {
    let mut latest = None;
    for line in rollout_reader(path).ok()?.lines().map_while(Result::ok) {
        if !line.contains("\"token_count\"") || !line.contains("\"total_token_usage\"") {
            continue;
        }
        let value = serde_json::from_str::<Value>(&line).ok()?;
        let usage = value.pointer("/payload/info/total_token_usage")?;
        latest = Some((
            usage
                .get("input_tokens")
                .and_then(Value::as_u64)
                .unwrap_or(0),
            usage
                .get("output_tokens")
                .and_then(Value::as_u64)
                .unwrap_or(0),
            usage
                .get("total_tokens")
                .and_then(Value::as_u64)
                .unwrap_or(0),
        ));
    }
    latest
}

pub(crate) fn measure_codex_thread_tokens_blocking<R: Runtime>(
    app: tauri::AppHandle<R>,
    session_ids: Vec<String>,
) -> Result<Vec<ThreadTokenTotals>, String> {
    let requested = normalized_ids(session_ids);
    let codex_home = resolve_paths(&app)?.codex_home;
    Ok(gather_snapshots(&codex_home)?
        .into_iter()
        .filter(|item| requested.contains(&item.session_id))
        .filter_map(|item| {
            let (input_tokens, output_tokens, total_tokens) = token_totals(&item.path)?;
            Some(ThreadTokenTotals {
                session_id: item.session_id,
                input_tokens,
                output_tokens,
                total_tokens,
            })
        })
        .collect())
}

fn bin_root<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法定位应用数据目录：{error}"))?
        .join("codex-thread-bin"))
}

fn safe_name(value: &str) -> String {
    value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_') {
                ch
            } else {
                '_'
            }
        })
        .collect()
}

fn rewrite_index(codex_home: &Path, removed: &HashSet<String>) -> Result<(), String> {
    let path = codex_home.join(INDEX_NAME);
    if !path.exists() {
        return Ok(());
    }
    let content = fs::read_to_string(&path)
        .map_err(|error| format!("无法读取会话索引 {}：{error}", path.display()))?;
    let retained = content
        .lines()
        .filter(|line| {
            serde_json::from_str::<Value>(line)
                .ok()
                .and_then(|value| value.get("id").and_then(Value::as_str).map(str::to_string))
                .is_none_or(|id| !removed.contains(&id))
        })
        .collect::<Vec<_>>()
        .join("\n");
    let next_content = if retained.is_empty() {
        String::new()
    } else {
        format!("{retained}\n")
    };
    write_text_atomic(&path, &next_content)
}

fn state_visibility_snapshot(
    state_db: Option<&Path>,
    session_id: &str,
) -> Result<Option<StateVisibilitySnapshot>, String> {
    let Some(state_db) = state_db else {
        return Ok(None);
    };
    let connection =
        Connection::open(state_db).map_err(|error| format!("无法打开 Codex state DB：{error}"))?;
    connection
        .busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|error| error.to_string())?;
    connection
        .query_row(
            "SELECT rollout_path, archived, archived_at, preview FROM threads WHERE id = ?1",
            params![session_id],
            |row| {
                Ok(StateVisibilitySnapshot {
                    rollout_path: row.get(0)?,
                    archived: row.get(1)?,
                    archived_at: row.get(2)?,
                    preview: row.get(3)?,
                })
            },
        )
        .optional()
        .map_err(|error| error.to_string())
}

fn sqlite_cell(value: rusqlite::types::ValueRef<'_>) -> SqliteCell {
    match value {
        rusqlite::types::ValueRef::Null => SqliteCell::Null,
        rusqlite::types::ValueRef::Integer(value) => SqliteCell::Integer(value),
        rusqlite::types::ValueRef::Real(value) => SqliteCell::Real(value),
        rusqlite::types::ValueRef::Text(value) => {
            SqliteCell::Text(String::from_utf8_lossy(value).to_string())
        }
        rusqlite::types::ValueRef::Blob(value) => SqliteCell::Blob(value.to_vec()),
    }
}

fn sql_value(value: &SqliteCell) -> SqlValue {
    match value {
        SqliteCell::Null => SqlValue::Null,
        SqliteCell::Integer(value) => SqlValue::Integer(*value),
        SqliteCell::Real(value) => SqlValue::Real(*value),
        SqliteCell::Text(value) => SqlValue::Text(value.clone()),
        SqliteCell::Blob(value) => SqlValue::Blob(value.clone()),
    }
}

fn sqlite_row_text<'a>(row: &'a SqliteRowSnapshot, column: &str) -> Option<&'a str> {
    row.columns
        .iter()
        .zip(&row.values)
        .find_map(|(name, value)| {
            (name == column)
                .then_some(value)
                .and_then(|value| match value {
                    SqliteCell::Text(value) => Some(value.as_str()),
                    _ => None,
                })
        })
}

fn quote_identifier(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

fn snapshot_thread_row(
    state_db: Option<&Path>,
    session_id: &str,
) -> Result<Option<SqliteRowSnapshot>, String> {
    let Some(state_db) = state_db else {
        return Ok(None);
    };
    let connection =
        Connection::open(state_db).map_err(|error| format!("无法打开 Codex state DB：{error}"))?;
    let mut statement = connection
        .prepare("SELECT * FROM threads WHERE id = ?1")
        .map_err(|error| error.to_string())?;
    let columns = statement
        .column_names()
        .into_iter()
        .map(str::to_string)
        .collect::<Vec<_>>();
    statement
        .query_row(params![session_id], |row| {
            let values = (0..columns.len())
                .map(|index| row.get_ref(index).map(sqlite_cell))
                .collect::<rusqlite::Result<Vec<_>>>()?;
            Ok(SqliteRowSnapshot {
                columns: columns.clone(),
                values,
            })
        })
        .optional()
        .map_err(|error| error.to_string())
}

fn snapshot_table_rows(
    database_path: Option<&Path>,
    database: &str,
    table: &str,
    predicate: &str,
    session_id: &str,
) -> Result<Option<SqliteTableSnapshot>, String> {
    let Some(database_path) = database_path else {
        return Ok(None);
    };
    let connection = Connection::open(database_path)
        .map_err(|error| format!("无法打开 Codex 数据库 {}：{error}", database_path.display()))?;
    connection
        .busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|error| error.to_string())?;
    if !table_exists(&connection, table)? {
        return Ok(None);
    }
    let sql = format!(
        "SELECT * FROM {} WHERE {predicate}",
        quote_identifier(table)
    );
    let mut statement = connection
        .prepare(&sql)
        .map_err(|error| error.to_string())?;
    let columns = statement
        .column_names()
        .into_iter()
        .map(str::to_string)
        .collect::<Vec<_>>();
    let rows = statement
        .query_map(params![session_id], |row| {
            let values = (0..columns.len())
                .map(|index| row.get_ref(index).map(sqlite_cell))
                .collect::<rusqlite::Result<Vec<_>>>()?;
            Ok(SqliteRowSnapshot {
                columns: columns.clone(),
                values,
            })
        })
        .map_err(|error| error.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|error| error.to_string())?;
    Ok((!rows.is_empty()).then(|| SqliteTableSnapshot {
        database: database.to_string(),
        table: table.to_string(),
        rows,
    }))
}

fn snapshot_related_state(
    codex_home: &Path,
    session_id: &str,
    included_ids: &HashSet<String>,
) -> Result<Vec<SqliteTableSnapshot>, String> {
    let state = latest_state_db(codex_home);
    let history = latest_versioned_db(codex_home, "thread_history_");
    let queue = latest_versioned_db(codex_home, "queue_");
    let goals = latest_versioned_db(codex_home, "goals_");
    let memories = latest_versioned_db(codex_home, "memories_");
    let specs = [
        (
            state.as_deref(),
            "state",
            "thread_dynamic_tools",
            "thread_id = ?1",
        ),
        (
            state.as_deref(),
            "state",
            "thread_spawn_edges",
            "parent_thread_id = ?1 OR child_thread_id = ?1",
        ),
        (
            history.as_deref(),
            "thread_history",
            "thread_turns",
            "thread_id = ?1",
        ),
        (
            history.as_deref(),
            "thread_history",
            "thread_items",
            "thread_id = ?1",
        ),
        (
            history.as_deref(),
            "thread_history",
            "thread_history_projection_state",
            "thread_id = ?1",
        ),
        (queue.as_deref(), "queue", "queued_items", "thread_id = ?1"),
        (goals.as_deref(), "goals", "thread_goals", "thread_id = ?1"),
        (
            goals.as_deref(),
            "goals",
            "thread_goal_continuation_deferrals",
            "thread_id = ?1",
        ),
        (
            memories.as_deref(),
            "memories",
            "stage1_outputs",
            "thread_id = ?1",
        ),
    ];
    let mut snapshots = Vec::new();
    for (path, database, table, predicate) in specs {
        if let Some(mut snapshot) =
            snapshot_table_rows(path, database, table, predicate, session_id)?
        {
            if snapshot.table == "thread_spawn_edges" {
                snapshot.rows.retain(|row| {
                    sqlite_row_text(row, "parent_thread_id")
                        .is_some_and(|id| included_ids.contains(id))
                        && sqlite_row_text(row, "child_thread_id")
                            .is_some_and(|id| included_ids.contains(id))
                });
            }
            if snapshot.rows.is_empty() {
                continue;
            }
            snapshots.push(snapshot);
        }
    }
    Ok(snapshots)
}

fn restore_thread_row(
    state_db: Option<&Path>,
    snapshot: Option<&SqliteRowSnapshot>,
    rollout_path: &Path,
    session_id: &str,
) -> Result<(), String> {
    let (Some(state_db), Some(snapshot)) = (state_db, snapshot) else {
        return Ok(());
    };
    let connection =
        Connection::open(state_db).map_err(|error| format!("无法打开 Codex state DB：{error}"))?;
    connection
        .busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|error| error.to_string())?;
    let mut info = connection
        .prepare("PRAGMA table_info(threads)")
        .map_err(|error| error.to_string())?;
    let available = info
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| error.to_string())?
        .collect::<rusqlite::Result<HashSet<_>>>()
        .map_err(|error| error.to_string())?;
    drop(info);

    let mut columns = Vec::new();
    let mut values = Vec::new();
    let logical_rollout =
        logical_rollout_path(rollout_path).unwrap_or_else(|| rollout_path.to_path_buf());
    for (column, value) in snapshot.columns.iter().zip(&snapshot.values) {
        if !available.contains(column) {
            continue;
        }
        columns.push(column.clone());
        values.push(match column.as_str() {
            "id" => SqlValue::Text(session_id.to_string()),
            "rollout_path" => SqlValue::Text(logical_rollout.to_string_lossy().to_string()),
            _ => sql_value(value),
        });
    }
    if columns.is_empty() {
        return Ok(());
    }
    let placeholders = (1..=columns.len())
        .map(|index| format!("?{index}"))
        .collect::<Vec<_>>()
        .join(", ");
    let sql = format!(
        "INSERT OR REPLACE INTO threads ({}) VALUES ({placeholders})",
        columns
            .iter()
            .map(|column| quote_identifier(column))
            .collect::<Vec<_>>()
            .join(", ")
    );
    connection
        .execute(&sql, params_from_iter(values))
        .map_err(|error| format!("无法恢复 Codex 会话索引：{error}"))?;
    Ok(())
}

fn related_database_path(codex_home: &Path, database: &str) -> Option<PathBuf> {
    match database {
        "state" => latest_state_db(codex_home),
        "thread_history" => latest_versioned_db(codex_home, "thread_history_"),
        "queue" => latest_versioned_db(codex_home, "queue_"),
        "goals" => latest_versioned_db(codex_home, "goals_"),
        "memories" => latest_versioned_db(codex_home, "memories_"),
        _ => None,
    }
}

fn valid_related_table(database: &str, table: &str) -> bool {
    matches!(
        (database, table),
        ("state", "thread_dynamic_tools")
            | ("state", "thread_spawn_edges")
            | ("thread_history", "thread_turns")
            | ("thread_history", "thread_items")
            | ("thread_history", "thread_history_projection_state")
            | ("queue", "queued_items")
            | ("goals", "thread_goals")
            | ("goals", "thread_goal_continuation_deferrals")
            | ("memories", "stage1_outputs")
    )
}

fn restore_table_snapshot(
    codex_home: &Path,
    snapshot: &SqliteTableSnapshot,
    session_id: &str,
) -> Result<(), String> {
    if !valid_related_table(&snapshot.database, &snapshot.table) {
        return Err("会话包包含不支持的 Codex 状态表".to_string());
    }
    let Some(path) = related_database_path(codex_home, &snapshot.database) else {
        return Ok(());
    };
    let mut connection = Connection::open(&path)
        .map_err(|error| format!("无法打开 Codex 数据库 {}：{error}", path.display()))?;
    connection
        .busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|error| error.to_string())?;
    if !table_exists(&connection, &snapshot.table)? {
        return Ok(());
    }
    let info_sql = format!("PRAGMA table_info({})", quote_identifier(&snapshot.table));
    let mut info = connection
        .prepare(&info_sql)
        .map_err(|error| error.to_string())?;
    let available = info
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| error.to_string())?
        .collect::<rusqlite::Result<HashSet<_>>>()
        .map_err(|error| error.to_string())?;
    drop(info);

    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    for row in &snapshot.rows {
        if snapshot.table == "thread_spawn_edges" {
            let references_session = row.columns.iter().zip(&row.values).any(|(column, value)| {
                matches!(column.as_str(), "parent_thread_id" | "child_thread_id")
                    && matches!(value, SqliteCell::Text(value) if value == session_id)
            });
            if !references_session {
                return Err("会话包包含无关的分叉关系".to_string());
            }
        }
        let mut columns = Vec::new();
        let mut values = Vec::new();
        for (column, value) in row.columns.iter().zip(&row.values) {
            if available.contains(column) {
                columns.push(column.clone());
                values.push(if column == "thread_id" {
                    SqlValue::Text(session_id.to_string())
                } else {
                    sql_value(value)
                });
            }
        }
        if columns.is_empty() {
            continue;
        }
        let placeholders = (1..=columns.len())
            .map(|index| format!("?{index}"))
            .collect::<Vec<_>>()
            .join(", ");
        let sql = format!(
            "INSERT OR REPLACE INTO {} ({}) VALUES ({placeholders})",
            quote_identifier(&snapshot.table),
            columns
                .iter()
                .map(|column| quote_identifier(column))
                .collect::<Vec<_>>()
                .join(", ")
        );
        transaction
            .execute(&sql, params_from_iter(values))
            .map_err(|error| format!("无法恢复 Codex 状态表 {}：{error}", snapshot.table))?;
    }
    transaction.commit().map_err(|error| error.to_string())
}

fn restore_related_state(
    codex_home: &Path,
    snapshots: &[SqliteTableSnapshot],
    session_id: &str,
) -> Result<(), String> {
    for snapshot in snapshots {
        restore_table_snapshot(codex_home, snapshot, session_id)?;
    }
    Ok(())
}

fn hide_thread_in_state(
    state_db: Option<&Path>,
    session_id: &str,
    recycle_path: &Path,
) -> Result<(), String> {
    let Some(state_db) = state_db else {
        return Ok(());
    };
    let connection =
        Connection::open(state_db).map_err(|error| format!("无法打开 Codex state DB：{error}"))?;
    connection
        .busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "UPDATE threads SET archived = 1, archived_at = ?1, preview = '', rollout_path = ?2 WHERE id = ?3",
            params![
                Utc::now().timestamp_millis(),
                recycle_path.to_string_lossy(),
                session_id
            ],
        )
        .map_err(|error| format!("无法同步 Codex 会话状态：{error}"))?;
    Ok(())
}

fn restore_thread_visibility(
    state_db: Option<&Path>,
    session_id: &str,
    snapshot: Option<&StateVisibilitySnapshot>,
) -> Result<(), String> {
    let (Some(state_db), Some(snapshot)) = (state_db, snapshot) else {
        return Ok(());
    };
    let connection =
        Connection::open(state_db).map_err(|error| format!("无法打开 Codex state DB：{error}"))?;
    connection
        .busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "UPDATE threads SET archived = ?1, archived_at = ?2, preview = ?3, rollout_path = ?4 WHERE id = ?5",
            params![
                snapshot.archived,
                snapshot.archived_at,
                snapshot.preview,
                snapshot.rollout_path,
                session_id
            ],
        )
        .map_err(|error| format!("无法恢复 Codex 会话状态：{error}"))?;
    Ok(())
}

fn ensure_threads_are_not_referenced(
    snapshots: &[RolloutSnapshot],
    requested: &HashSet<String>,
    state_db: Option<&Path>,
) -> Result<(), String> {
    for item in snapshots {
        if requested.contains(&item.session_id) {
            continue;
        }
        let referenced = [
            item.history_base_thread_id.as_deref(),
            item.parent_thread_id.as_deref(),
        ]
        .into_iter()
        .flatten()
        .find(|id| requested.contains(*id));
        if let Some(parent) = referenced {
            return Err(format!(
                "会话 {parent} 仍被会话 {} 引用，请同时选择相关会话后再移入回收站",
                item.session_id
            ));
        }
    }

    let Some(state_db) = state_db else {
        return Ok(());
    };
    let connection =
        Connection::open(state_db).map_err(|error| format!("无法打开 Codex state DB：{error}"))?;
    let mut statement = match connection
        .prepare("SELECT parent_thread_id, child_thread_id FROM thread_spawn_edges")
    {
        Ok(statement) => statement,
        Err(_) => return Ok(()),
    };
    let rows = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|error| error.to_string())?;
    for row in rows {
        let (parent, child) = row.map_err(|error| error.to_string())?;
        if requested.contains(&parent) && !requested.contains(&child) {
            return Err(format!(
                "会话 {parent} 仍有未选择的子会话 {child}，请同时选择后再移入回收站"
            ));
        }
    }
    Ok(())
}

fn restore_moved_files(moved: &[(PathBuf, PathBuf)]) {
    for (source, target) in moved.iter().rev() {
        if target.exists() {
            if let Some(parent) = source.parent() {
                let _ = fs::create_dir_all(parent);
            }
            let _ = fs::rename(target, source);
        }
    }
}

pub(crate) fn discard_codex_threads_blocking<R: Runtime>(
    app: tauri::AppHandle<R>,
    session_ids: Vec<String>,
) -> Result<MutationReport, String> {
    let requested = normalized_ids(session_ids);
    if requested.is_empty() {
        return Err("请至少选择一条会话".to_string());
    }
    let paths = resolve_paths(&app)?;
    let all_snapshots = gather_snapshots(&paths.codex_home)?;
    let state_db = latest_state_db(&paths.codex_home);
    ensure_threads_are_not_referenced(&all_snapshots, &requested, state_db.as_deref())?;
    let snapshots = all_snapshots
        .into_iter()
        .filter(|item| requested.contains(&item.session_id))
        .collect::<Vec<_>>();
    if snapshots.is_empty() {
        return Ok(MutationReport {
            requested_count: requested.len(),
            affected_count: 0,
            released_bytes: 0,
            message: "所选会话已不存在".to_string(),
        });
    }
    let batch = bin_root(&app)?.join(Utc::now().format("%Y%m%d-%H%M%S").to_string());
    fs::create_dir_all(&batch).map_err(|error| format!("无法创建会话回收站：{error}"))?;
    let mut moved = HashSet::new();
    for snapshot in snapshots {
        let folder = batch.join(format!(
            "{}--{}",
            safe_name(&snapshot.session_id),
            Uuid::new_v4()
        ));
        let target = folder.join("files").join(&snapshot.relative_path);
        let state_visibility =
            state_visibility_snapshot(state_db.as_deref(), &snapshot.session_id)?;
        let manifest = BinManifest {
            session_id: snapshot.session_id.clone(),
            title: snapshot.title,
            cwd: snapshot.cwd,
            original_rollout_path: snapshot.path.clone(),
            relative_rollout_path: snapshot.relative_path.to_string_lossy().to_string(),
            session_index_entry: snapshot.index_value,
            deleted_at: Utc::now().to_rfc3339(),
            state_visibility,
        };
        let manifest_text = serde_json::to_string_pretty(&manifest)
            .map_err(|error| format!("无法生成回收站清单：{error}"))?;
        write_text_atomic(&folder.join("manifest.json"), &format!("{manifest_text}\n"))?;
        let mut moved_files = Vec::new();
        for source in &snapshot.physical_paths {
            let relative = source.strip_prefix(&paths.codex_home).unwrap_or(source);
            let target = folder.join("files").join(relative);
            fs::create_dir_all(target.parent().unwrap_or(&folder))
                .map_err(|error| format!("无法创建回收站条目：{error}"))?;
            if let Err(error) = fs::rename(source, &target) {
                restore_moved_files(&moved_files);
                return Err(format!(
                    "无法将会话移入回收站 {}：{error}",
                    source.display()
                ));
            }
            moved_files.push((source.clone(), target));
        }
        let recycle_path = moved_files
            .iter()
            .find(|(source, _)| *source == snapshot.path)
            .map(|(_, target)| target.as_path())
            .unwrap_or(target.as_path());
        if let Err(error) =
            hide_thread_in_state(state_db.as_deref(), &snapshot.session_id, recycle_path)
        {
            restore_moved_files(&moved_files);
            return Err(error);
        }
        moved.insert(snapshot.session_id);
    }
    rewrite_index(&paths.codex_home, &moved)?;
    Ok(MutationReport {
        requested_count: requested.len(),
        affected_count: moved.len(),
        released_bytes: 0,
        message: format!("已将 {} 条会话移到回收站", moved.len()),
    })
}

fn collect_bin_entries<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<Vec<BinSnapshot>, String> {
    let root = bin_root(app)?;
    if !root.exists() {
        return Ok(Vec::new());
    }
    let mut result = Vec::new();
    for batch in fs::read_dir(&root).map_err(|error| format!("无法读取会话回收站：{error}"))?
    {
        let batch = batch.map_err(|error| error.to_string())?.path();
        if !batch.is_dir() {
            continue;
        }
        for entry in fs::read_dir(&batch).map_err(|error| error.to_string())? {
            let folder = entry.map_err(|error| error.to_string())?.path();
            let manifest_path = folder.join("manifest.json");
            if !manifest_path.is_file() {
                continue;
            }
            let manifest: BinManifest = serde_json::from_slice(
                &fs::read(&manifest_path).map_err(|error| error.to_string())?,
            )
            .map_err(|error| format!("回收站清单损坏 {}：{error}", manifest_path.display()))?;
            let files_root = folder.join("files");
            let mut rollouts = Vec::new();
            collect_physical_rollouts(&files_root, &mut rollouts)?;
            if !rollouts.is_empty() {
                result.push(BinSnapshot {
                    folder,
                    manifest,
                    rollouts,
                });
            }
        }
    }
    Ok(result)
}

fn collect_physical_rollouts(root: &Path, result: &mut Vec<PathBuf>) -> Result<(), String> {
    if !root.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(root).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        if entry
            .file_type()
            .map_err(|error| error.to_string())?
            .is_dir()
        {
            collect_physical_rollouts(&path, result)?;
        } else if logical_rollout_path(&path).is_some() {
            result.push(path);
        }
    }
    result.sort();
    Ok(())
}

fn directory_size(path: &Path) -> u64 {
    if path.is_file() {
        return fs::metadata(path).map(|value| value.len()).unwrap_or(0);
    }
    fs::read_dir(path)
        .ok()
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .map(|entry| directory_size(&entry.path()))
        .sum()
}

fn latest_versioned_db(codex_home: &Path, prefix: &str) -> Option<PathBuf> {
    fs::read_dir(codex_home)
        .ok()?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().to_string();
            let version = name
                .strip_prefix(prefix)?
                .strip_suffix(".sqlite")?
                .parse::<u64>()
                .ok()?;
            Some((version, entry.path()))
        })
        .max_by_key(|(version, _)| *version)
        .map(|(_, path)| path)
}

fn table_exists(connection: &Connection, table: &str) -> Result<bool, String> {
    connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1)",
            params![table],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())
}

fn delete_thread_rows(
    path: Option<PathBuf>,
    session_id: &str,
    operations: &[(&str, &str)],
) -> Result<(), String> {
    let Some(path) = path else {
        return Ok(());
    };
    let mut connection = Connection::open(&path)
        .map_err(|error| format!("无法打开 Codex 数据库 {}：{error}", path.display()))?;
    connection
        .busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|error| error.to_string())?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    for (table, sql) in operations {
        if table_exists(&transaction, table)? {
            transaction
                .execute(sql, params![session_id])
                .map_err(|error| format!("无法清理 Codex 数据库 {}：{error}", path.display()))?;
        }
    }
    transaction.commit().map_err(|error| error.to_string())
}

fn purge_thread_state(codex_home: &Path, session_id: &str) -> Result<(), String> {
    delete_thread_rows(
        latest_state_db(codex_home),
        session_id,
        &[
            ("thread_dynamic_tools", "DELETE FROM thread_dynamic_tools WHERE thread_id = ?1"),
            ("thread_spawn_edges", "DELETE FROM thread_spawn_edges WHERE child_thread_id = ?1 OR parent_thread_id = ?1"),
            ("thread_goal_continuation_deferrals", "DELETE FROM thread_goal_continuation_deferrals WHERE thread_id = ?1"),
            ("thread_goals", "DELETE FROM thread_goals WHERE thread_id = ?1"),
            ("stage1_outputs", "DELETE FROM stage1_outputs WHERE thread_id = ?1"),
            ("logs", "DELETE FROM logs WHERE thread_id = ?1"),
            ("threads", "DELETE FROM threads WHERE id = ?1"),
        ],
    )?;
    delete_thread_rows(
        latest_versioned_db(codex_home, "thread_history_"),
        session_id,
        &[
            (
                "thread_items",
                "DELETE FROM thread_items WHERE thread_id = ?1",
            ),
            (
                "thread_turns",
                "DELETE FROM thread_turns WHERE thread_id = ?1",
            ),
            (
                "thread_history_projection_state",
                "DELETE FROM thread_history_projection_state WHERE thread_id = ?1",
            ),
        ],
    )?;
    delete_thread_rows(
        latest_versioned_db(codex_home, "queue_"),
        session_id,
        &[(
            "queued_items",
            "DELETE FROM queued_items WHERE thread_id = ?1",
        )],
    )?;
    delete_thread_rows(
        latest_versioned_db(codex_home, "goals_"),
        session_id,
        &[
            (
                "thread_goal_continuation_deferrals",
                "DELETE FROM thread_goal_continuation_deferrals WHERE thread_id = ?1",
            ),
            (
                "thread_goals",
                "DELETE FROM thread_goals WHERE thread_id = ?1",
            ),
        ],
    )?;
    delete_thread_rows(
        latest_versioned_db(codex_home, "memories_"),
        session_id,
        &[(
            "stage1_outputs",
            "DELETE FROM stage1_outputs WHERE thread_id = ?1",
        )],
    )?;
    delete_thread_rows(
        latest_versioned_db(codex_home, "logs_"),
        session_id,
        &[("logs", "DELETE FROM logs WHERE thread_id = ?1")],
    )
}

pub(crate) fn browse_codex_thread_bin_blocking<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<Vec<BinEntry>, String> {
    let mut grouped = HashMap::<String, BinEntry>::new();
    for item in collect_bin_entries(&app)? {
        let deleted_at = DateTime::parse_from_rfc3339(&item.manifest.deleted_at)
            .ok()
            .map(|value| value.timestamp());
        let size = directory_size(&item.folder);
        let entry = grouped
            .entry(item.manifest.session_id.clone())
            .or_insert(BinEntry {
                session_id: item.manifest.session_id,
                title: item.manifest.title,
                cwd: item.manifest.cwd,
                deleted_at,
                size_bytes: 0,
            });
        entry.size_bytes = entry.size_bytes.saturating_add(size);
        if deleted_at.unwrap_or_default() > entry.deleted_at.unwrap_or_default() {
            entry.deleted_at = deleted_at;
        }
    }
    let mut result = grouped.into_values().collect::<Vec<_>>();
    result.sort_by(|a, b| {
        b.deleted_at
            .unwrap_or_default()
            .cmp(&a.deleted_at.unwrap_or_default())
    });
    Ok(result)
}

fn append_index_entry(codex_home: &Path, session_id: &str, entry: &Value) -> Result<(), String> {
    let mut entries = index_values(codex_home)?;
    entries.insert(session_id.to_string(), entry.clone());
    let mut values = entries.into_values().collect::<Vec<_>>();
    values.sort_by(|a, b| {
        index_timestamp(Some(b))
            .unwrap_or_default()
            .cmp(&index_timestamp(Some(a)).unwrap_or_default())
    });
    let mut output = String::new();
    for value in values {
        output.push_str(&serde_json::to_string(&value).map_err(|error| error.to_string())?);
        output.push('\n');
    }
    write_text_atomic(&codex_home.join(INDEX_NAME), &output)
}

pub(crate) fn recover_codex_threads_blocking<R: Runtime>(
    app: tauri::AppHandle<R>,
    session_ids: Vec<String>,
) -> Result<MutationReport, String> {
    let requested = normalized_ids(session_ids);
    if requested.is_empty() {
        return Err("请至少选择一条待恢复会话".to_string());
    }
    let codex_home = resolve_paths(&app)?.codex_home;
    let state_db = latest_state_db(&codex_home);
    let mut restored = HashSet::new();
    for item in collect_bin_entries(&app)?
        .into_iter()
        .filter(|item| requested.contains(&item.manifest.session_id))
    {
        let files_root = item.folder.join("files");
        let targets = item
            .rollouts
            .iter()
            .filter_map(|source| {
                source
                    .strip_prefix(&files_root)
                    .ok()
                    .map(|relative| (source.clone(), codex_home.join(relative)))
            })
            .collect::<Vec<_>>();
        if targets.is_empty() || targets.iter().any(|(_, target)| target.exists()) {
            continue;
        }
        let mut moved = Vec::new();
        for (source, target) in &targets {
            fs::create_dir_all(target.parent().unwrap_or(&codex_home))
                .map_err(|error| format!("无法创建会话目录：{error}"))?;
            if let Err(error) = fs::rename(source, target) {
                restore_moved_files(&moved);
                return Err(format!(
                    "无法恢复会话 {}：{error}",
                    item.manifest.session_id
                ));
            }
            moved.push((source.clone(), target.clone()));
        }
        if let Err(error) = restore_thread_visibility(
            state_db.as_deref(),
            &item.manifest.session_id,
            item.manifest.state_visibility.as_ref(),
        ) {
            restore_moved_files(&moved);
            return Err(error);
        }
        append_index_entry(
            &codex_home,
            &item.manifest.session_id,
            &item.manifest.session_index_entry,
        )?;
        let _ = fs::remove_dir_all(&item.folder);
        restored.insert(item.manifest.session_id);
    }
    Ok(MutationReport {
        requested_count: requested.len(),
        affected_count: restored.len(),
        released_bytes: 0,
        message: format!("已恢复 {} 条会话", restored.len()),
    })
}

fn delete_bin_items<R: Runtime>(
    app: &tauri::AppHandle<R>,
    requested: Option<&HashSet<String>>,
) -> Result<MutationReport, String> {
    let entries = collect_bin_entries(app)?;
    let codex_home = resolve_paths(app)?.codex_home;
    let target_ids = entries
        .iter()
        .filter(|item| requested.is_none_or(|values| values.contains(&item.manifest.session_id)))
        .map(|item| item.manifest.session_id.clone())
        .collect::<HashSet<_>>();
    ensure_threads_are_not_referenced(
        &gather_snapshots(&codex_home)?,
        &target_ids,
        latest_state_db(&codex_home).as_deref(),
    )?;
    for id in &target_ids {
        purge_thread_state(&codex_home, id)?;
    }
    let mut ids = HashSet::new();
    let mut released = 0u64;
    for item in entries
        .into_iter()
        .filter(|item| requested.is_none_or(|values| values.contains(&item.manifest.session_id)))
    {
        released = released.saturating_add(directory_size(&item.folder));
        fs::remove_dir_all(&item.folder)
            .map_err(|error| format!("无法永久删除会话 {}：{error}", item.manifest.session_id))?;
        ids.insert(item.manifest.session_id);
    }
    Ok(MutationReport {
        requested_count: requested.map(HashSet::len).unwrap_or(ids.len()),
        affected_count: ids.len(),
        released_bytes: released,
        message: format!("已永久删除 {} 条会话", ids.len()),
    })
}

pub(crate) fn purge_codex_threads_blocking<R: Runtime>(
    app: tauri::AppHandle<R>,
    session_ids: Vec<String>,
) -> Result<MutationReport, String> {
    let requested = normalized_ids(session_ids);
    if requested.is_empty() {
        return Err("请至少选择一条要永久删除的会话".to_string());
    }
    delete_bin_items(&app, Some(&requested))
}

pub(crate) fn empty_codex_thread_bin_blocking<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<MutationReport, String> {
    delete_bin_items(&app, None)
}

fn sha256(path: &Path) -> Result<String, String> {
    let mut file = File::open(path).map_err(|error| error.to_string())?;
    let mut digest = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let count = file.read(&mut buffer).map_err(|error| error.to_string())?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    Ok(format!("{:x}", digest.finalize()))
}

fn selected_snapshots(
    codex_home: &Path,
    ids: &HashSet<String>,
) -> Result<Vec<RolloutSnapshot>, String> {
    let mut seen = HashSet::new();
    Ok(gather_snapshots(codex_home)?
        .into_iter()
        .filter(|item| ids.contains(&item.session_id) && seen.insert(item.session_id.clone()))
        .collect())
}

fn ensure_export_dependencies(snapshots: &[RolloutSnapshot]) -> Result<HashSet<String>, String> {
    let included = snapshots
        .iter()
        .map(|item| item.session_id.clone())
        .collect::<HashSet<_>>();
    for item in snapshots {
        for dependency in [
            item.history_base_thread_id.as_deref(),
            item.parent_thread_id.as_deref(),
        ]
        .into_iter()
        .flatten()
        {
            if !included.contains(dependency) {
                return Err(format!(
                    "会话 {} 依赖会话 {dependency}，请一起选择后再导出",
                    item.session_id
                ));
            }
        }
    }
    Ok(included)
}

pub(crate) fn inspect_codex_thread_export_blocking<R: Runtime>(
    app: tauri::AppHandle<R>,
    session_ids: Vec<String>,
) -> Result<BundlePreview, String> {
    let requested = normalized_ids(session_ids);
    if requested.is_empty() {
        return Err("请至少选择一条会话".to_string());
    }
    let snapshots = selected_snapshots(&resolve_paths(&app)?.codex_home, &requested)?;
    ensure_export_dependencies(&snapshots)?;
    let items = snapshots
        .into_iter()
        .map(|item| BundlePreviewItem {
            session_id: item.session_id,
            title: item.title,
            cwd: item.cwd,
            updated_at: item.updated_at,
            size_bytes: item.size_bytes,
            status: "ready".to_string(),
            reason: None,
        })
        .collect::<Vec<_>>();
    Ok(BundlePreview {
        package_version: BUNDLE_REVISION,
        exported_at: None,
        total_count: requested.len(),
        ready_count: items.len(),
        total_size_bytes: items.iter().map(|item| item.size_bytes).sum(),
        items,
    })
}

pub(crate) fn pack_codex_threads_blocking<R: Runtime>(
    app: tauri::AppHandle<R>,
    session_ids: Vec<String>,
    export_path: String,
) -> Result<BundleResult, String> {
    let requested = normalized_ids(session_ids);
    if requested.is_empty() {
        return Err("请至少选择一条会话".to_string());
    }
    let codex_home = resolve_paths(&app)?.codex_home;
    let snapshots = selected_snapshots(&codex_home, &requested)?;
    let included_ids = ensure_export_dependencies(&snapshots)?;
    let state_db = latest_state_db(&codex_home);
    let destination = PathBuf::from(export_path.trim());
    if destination.as_os_str().is_empty() {
        return Err("请选择导出位置".to_string());
    }
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("无法创建导出目录：{error}"))?;
    }
    let temporary = destination.with_extension(format!("tmp-{}", Uuid::new_v4()));
    let file = File::create(&temporary).map_err(|error| format!("无法创建会话包：{error}"))?;
    let mut archive = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    let mut manifest_items = Vec::new();
    for (index, snapshot) in snapshots.iter().enumerate() {
        let file_entry = format!(
            "files/{:04}-{}/rollout.jsonl",
            index + 1,
            safe_name(&snapshot.session_id)
        );
        archive
            .start_file(&file_entry, options)
            .map_err(|error| error.to_string())?;
        let mut source = File::open(&snapshot.path).map_err(|error| error.to_string())?;
        std::io::copy(&mut source, &mut archive).map_err(|error| error.to_string())?;
        manifest_items.push(PackageItem {
            session_id: snapshot.session_id.clone(),
            title: snapshot.title.clone(),
            cwd: snapshot.cwd.clone(),
            updated_at: snapshot.updated_at,
            relative_rollout_path: snapshot.relative_path.to_string_lossy().replace('\\', "/"),
            file_entry,
            size_bytes: snapshot.size_bytes,
            sha256: sha256(&snapshot.path)?,
            session_index_entry: snapshot.index_value.clone(),
            source_instance: Some(json!({ "id": "__default__", "name": "默认实例" })),
            state_row: snapshot_thread_row(state_db.as_deref(), &snapshot.session_id)?,
            related_state: snapshot_related_state(
                &codex_home,
                &snapshot.session_id,
                &included_ids,
            )?,
        });
    }
    let manifest = PackageManifest {
        kind: BUNDLE_KIND.to_string(),
        package_version: BUNDLE_REVISION,
        exported_at: Utc::now().to_rfc3339(),
        sessions: manifest_items,
    };
    archive
        .start_file("manifest.json", options)
        .map_err(|error| error.to_string())?;
    archive
        .write_all(
            serde_json::to_string_pretty(&manifest)
                .map_err(|error| error.to_string())?
                .as_bytes(),
        )
        .map_err(|error| error.to_string())?;
    archive
        .finish()
        .map_err(|error| error.to_string())?
        .sync_all()
        .map_err(|error| error.to_string())?;
    replace_file(&temporary, &destination).map_err(|error| format!("无法保存会话包：{error}"))?;
    Ok(BundleResult {
        requested_count: requested.len(),
        completed_count: snapshots.len(),
        skipped_count: requested.len().saturating_sub(snapshots.len()),
        path: destination.to_string_lossy().to_string(),
        message: format!("已导出 {} 条会话", snapshots.len()),
    })
}

fn read_package(path: &Path) -> Result<PackageManifest, String> {
    let file = File::open(path).map_err(|error| format!("无法打开会话包：{error}"))?;
    let mut archive = ZipArchive::new(file).map_err(|error| format!("会话包格式无效：{error}"))?;
    let mut manifest_file = archive
        .by_name("manifest.json")
        .map_err(|_| "会话包缺少 manifest.json".to_string())?;
    let mut content = String::new();
    manifest_file
        .read_to_string(&mut content)
        .map_err(|error| error.to_string())?;
    let manifest: PackageManifest =
        serde_json::from_str(&content).map_err(|error| format!("会话包清单无效：{error}"))?;
    if manifest.kind != BUNDLE_KIND || manifest.package_version != BUNDLE_REVISION {
        return Err("不支持此会话包版本".to_string());
    }
    Ok(manifest)
}

pub(crate) fn inspect_codex_thread_import_blocking<R: Runtime>(
    app: tauri::AppHandle<R>,
    import_path: String,
) -> Result<BundlePreview, String> {
    let path = PathBuf::from(import_path.trim());
    let manifest = read_package(&path)?;
    let existing = gather_snapshots(&resolve_paths(&app)?.codex_home)?
        .into_iter()
        .map(|item| item.session_id)
        .collect::<HashSet<_>>();
    let items = manifest
        .sessions
        .iter()
        .map(|item| {
            let duplicate = existing.contains(&item.session_id);
            BundlePreviewItem {
                session_id: item.session_id.clone(),
                title: item.title.clone(),
                cwd: item.cwd.clone(),
                updated_at: item.updated_at,
                size_bytes: item.size_bytes,
                status: if duplicate { "duplicate" } else { "ready" }.to_string(),
                reason: duplicate.then(|| "默认实例已存在同 ID 会话".to_string()),
            }
        })
        .collect::<Vec<_>>();
    Ok(BundlePreview {
        package_version: manifest.package_version,
        exported_at: Some(manifest.exported_at),
        total_count: items.len(),
        ready_count: items.iter().filter(|item| item.status == "ready").count(),
        total_size_bytes: items.iter().map(|item| item.size_bytes).sum(),
        items,
    })
}

fn safe_relative_path(value: &str) -> Option<PathBuf> {
    let normalized = value.replace('\\', "/");
    let bytes = normalized.as_bytes();
    let has_windows_drive_prefix = matches!(
        (bytes.first(), bytes.get(1)),
        (Some(drive), Some(b':')) if drive.is_ascii_alphabetic()
    );
    let path = PathBuf::from(normalized);
    (!path.as_os_str().is_empty()
        && !has_windows_drive_prefix
        && !path.is_absolute()
        && path
            .components()
            .all(|part| matches!(part, std::path::Component::Normal(_))))
    .then_some(path)
}

pub(crate) fn unpack_codex_threads_blocking<R: Runtime>(
    app: tauri::AppHandle<R>,
    import_path: String,
    session_ids: Vec<String>,
) -> Result<BundleResult, String> {
    let requested = normalized_ids(session_ids);
    if requested.is_empty() {
        return Err("请至少选择一条要导入的会话".to_string());
    }
    let path = PathBuf::from(import_path.trim());
    let manifest = read_package(&path)?;
    let codex_home = resolve_paths(&app)?.codex_home;
    let state_db = latest_state_db(&codex_home);
    let mut existing = gather_snapshots(&codex_home)?
        .into_iter()
        .map(|item| item.session_id)
        .collect::<HashSet<_>>();
    let file = File::open(&path).map_err(|error| error.to_string())?;
    let mut archive = ZipArchive::new(file).map_err(|error| error.to_string())?;
    let mut imported = 0usize;
    for item in manifest
        .sessions
        .iter()
        .filter(|item| requested.contains(&item.session_id))
    {
        if existing.contains(&item.session_id) {
            continue;
        }
        let relative = safe_relative_path(&item.relative_rollout_path).unwrap_or_else(|| {
            PathBuf::from("sessions").join(format!("rollout-{}.jsonl", item.session_id))
        });
        let target = codex_home.join(relative);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let mut packaged = archive
            .by_name(&item.file_entry)
            .map_err(|error| format!("会话包文件缺失：{error}"))?;
        let temporary = target.with_extension(format!("tmp-{}", Uuid::new_v4()));
        let mut output = File::create(&temporary).map_err(|error| error.to_string())?;
        std::io::copy(&mut packaged, &mut output).map_err(|error| error.to_string())?;
        output.sync_all().map_err(|error| error.to_string())?;
        if sha256(&temporary)? != item.sha256 {
            let _ = fs::remove_file(&temporary);
            return Err(format!("会话 {} 校验失败", item.session_id));
        }
        replace_file(&temporary, &target).map_err(|error| error.to_string())?;
        if let Err(error) = restore_thread_row(
            state_db.as_deref(),
            item.state_row.as_ref(),
            &target,
            &item.session_id,
        ) {
            let _ = fs::remove_file(&target);
            return Err(error);
        }
        if let Err(error) =
            restore_related_state(&codex_home, &item.related_state, &item.session_id)
        {
            let _ = purge_thread_state(&codex_home, &item.session_id);
            let _ = fs::remove_file(&target);
            return Err(error);
        }
        append_index_entry(&codex_home, &item.session_id, &item.session_index_entry)?;
        existing.insert(item.session_id.clone());
        imported += 1;
    }
    Ok(BundleResult {
        requested_count: requested.len(),
        completed_count: imported,
        skipped_count: requested.len().saturating_sub(imported),
        path: path.to_string_lossy().to_string(),
        message: format!("已导入 {} 条会话", imported),
    })
}

fn current_model_provider(config_path: &Path) -> String {
    let Ok(content) = fs::read_to_string(config_path) else {
        return "openai".to_string();
    };
    content
        .lines()
        .map(str::trim)
        .find_map(|line| {
            let value = line
                .strip_prefix("model_provider")?
                .trim()
                .strip_prefix('=')?
                .trim();
            Some(value.trim_matches(['\'', '"']).trim().to_string())
        })
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "openai".to_string())
}

fn latest_state_db(codex_home: &Path) -> Option<PathBuf> {
    fs::read_dir(codex_home)
        .ok()?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().to_string();
            let version = name
                .strip_prefix("state_")?
                .strip_suffix(".sqlite")?
                .parse::<u64>()
                .ok()?;
            Some((version, entry.path()))
        })
        .max_by_key(|(version, _)| *version)
        .map(|(_, path)| path)
}

fn table_has_column(connection: &Connection, table: &str, column: &str) -> Result<bool, String> {
    let mut statement = connection
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(|error| error.to_string())?;
    let values = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| error.to_string())?;
    for value in values {
        if value.map_err(|error| error.to_string())? == column {
            return Ok(true);
        }
    }
    Ok(false)
}

fn create_visibility_checkpoint<R: Runtime>(
    app: &tauri::AppHandle<R>,
    codex_home: &Path,
    state_db: Option<&Path>,
    snapshots: &[&RolloutSnapshot],
) -> Result<Option<PathBuf>, String> {
    let index_path = codex_home.join(INDEX_NAME);
    if state_db.is_none() && snapshots.is_empty() && !index_path.exists() {
        return Ok(None);
    }
    let root = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("codex-thread-backups")
        .join(Utc::now().format("%Y%m%d-%H%M%S").to_string());
    fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    if let Some(state_db) = state_db {
        fs::copy(
            state_db,
            root.join(state_db.file_name().unwrap_or_default()),
        )
        .map_err(|error| error.to_string())?;
        for suffix in ["-wal", "-shm"] {
            let companion = PathBuf::from(format!("{}{suffix}", state_db.display()));
            if companion.exists() {
                let name = companion.file_name().unwrap_or_default();
                let _ = fs::copy(&companion, root.join(name));
            }
        }
    }
    if index_path.exists() {
        fs::copy(&index_path, root.join(INDEX_NAME)).map_err(|error| error.to_string())?;
    }
    for snapshot in snapshots {
        let target = root.join("rollouts").join(&snapshot.relative_path);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        fs::copy(&snapshot.path, &target).map_err(|error| error.to_string())?;
    }
    Ok(Some(root))
}

fn rewrite_rollout_provider(path: &Path, target_provider: &str) -> Result<bool, String> {
    let mut reader = rollout_reader(path)?;
    let mut first = String::new();
    reader
        .read_line(&mut first)
        .map_err(|error| error.to_string())?;
    let mut meta: Value =
        serde_json::from_str(first.trim_end()).map_err(|error| error.to_string())?;
    let Some(provider) = meta.pointer_mut("/payload/model_provider") else {
        return Ok(false);
    };
    if provider.as_str() == Some(target_provider) {
        return Ok(false);
    }
    *provider = Value::String(target_provider.to_string());
    let temporary = path.with_extension(format!("visibility-{}.tmp", Uuid::new_v4()));
    if path.extension().and_then(|value| value.to_str()) == Some("zst") {
        let output = File::create(&temporary).map_err(|error| error.to_string())?;
        let mut encoder =
            zstd::stream::write::Encoder::new(output, 3).map_err(|error| error.to_string())?;
        serde_json::to_writer(&mut encoder, &meta).map_err(|error| error.to_string())?;
        encoder
            .write_all(b"\n")
            .map_err(|error| error.to_string())?;
        std::io::copy(&mut reader, &mut encoder).map_err(|error| error.to_string())?;
        encoder
            .finish()
            .map_err(|error| error.to_string())?
            .sync_all()
            .map_err(|error| error.to_string())?;
    } else {
        let mut output = File::create(&temporary).map_err(|error| error.to_string())?;
        serde_json::to_writer(&mut output, &meta).map_err(|error| error.to_string())?;
        output.write_all(b"\n").map_err(|error| error.to_string())?;
        std::io::copy(&mut reader, &mut output).map_err(|error| error.to_string())?;
        output.sync_all().map_err(|error| error.to_string())?;
    }
    // Windows does not allow replacing the rollout while its decoder still owns
    // an open handle to the original file.
    drop(reader);
    replace_file(&temporary, path).map_err(|error| error.to_string())?;
    Ok(true)
}

fn rebuild_index_from_snapshots(
    codex_home: &Path,
    snapshots: &[RolloutSnapshot],
) -> Result<usize, String> {
    let existing = index_values(codex_home)?;
    let mut values = Vec::new();
    for item in snapshots {
        let mut value = existing
            .get(&item.session_id)
            .cloned()
            .unwrap_or_else(|| item.index_value.clone());
        if let Some(object) = value.as_object_mut() {
            object.insert("id".to_string(), Value::String(item.session_id.clone()));
            if !object.contains_key("thread_name") {
                object.insert("thread_name".to_string(), Value::String(item.title.clone()));
            }
            if let Some(updated_at) = item.updated_at {
                object.insert(
                    "updated_at".to_string(),
                    Value::String(
                        DateTime::<Utc>::from_timestamp(updated_at, 0)
                            .unwrap_or_else(Utc::now)
                            .to_rfc3339(),
                    ),
                );
            }
        }
        values.push(value);
    }
    values.sort_by(|a, b| {
        index_timestamp(Some(b))
            .unwrap_or_default()
            .cmp(&index_timestamp(Some(a)).unwrap_or_default())
    });
    let mut output = String::new();
    for value in values {
        output.push_str(&serde_json::to_string(&value).map_err(|error| error.to_string())?);
        output.push('\n');
    }
    write_text_atomic(&codex_home.join(INDEX_NAME), &output)?;
    Ok(snapshots.len())
}

fn update_main_state(
    state_db: &Path,
    target_provider: &str,
    selected: Option<&HashSet<String>>,
    dry_run: bool,
) -> Result<usize, String> {
    let connection =
        Connection::open(state_db).map_err(|error| format!("无法打开 Codex state DB：{error}"))?;
    connection
        .busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|error| error.to_string())?;
    if !table_has_column(&connection, "threads", "model_provider")? {
        return Ok(0);
    }
    let mut changed = 0usize;
    let ids = if let Some(selected) = selected {
        selected.iter().cloned().collect::<Vec<_>>()
    } else {
        let mut statement = connection
            .prepare("SELECT id FROM threads WHERE model_provider != ?1 OR model_provider IS NULL")
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map(params![target_provider], |row| row.get::<_, String>(0))
            .map_err(|error| error.to_string())?
            .filter_map(Result::ok)
            .collect();
        rows
    };
    for id in ids {
        let differs = connection
            .query_row(
                "SELECT model_provider != ?1 OR model_provider IS NULL FROM threads WHERE id = ?2",
                params![target_provider, id],
                |row| row.get::<_, bool>(0),
            )
            .optional()
            .map_err(|error| error.to_string())?
            .unwrap_or(false);
        if differs {
            changed += 1;
            if !dry_run {
                connection
                    .execute(
                        "UPDATE threads SET model_provider = ?1 WHERE id = ?2",
                        params![target_provider, id],
                    )
                    .map_err(|error| error.to_string())?;
            }
        }
    }
    Ok(changed)
}

fn update_catalogs(
    codex_home: &Path,
    provider: &str,
    ids: &HashSet<String>,
    dry_run: bool,
) -> Result<usize, String> {
    let directory = codex_home.join("sqlite");
    if !directory.exists() {
        return Ok(0);
    }
    let mut changed = 0usize;
    for entry in fs::read_dir(directory).map_err(|error| error.to_string())? {
        let path = entry.map_err(|error| error.to_string())?.path();
        if path.extension().and_then(|value| value.to_str()) != Some("db") {
            continue;
        }
        let connection = Connection::open(&path).map_err(|error| error.to_string())?;
        if !table_has_column(&connection, "local_thread_catalog", "model_provider")? {
            continue;
        }
        for id in ids {
            let differs = connection.query_row(
                "SELECT model_provider != ?1 OR model_provider IS NULL FROM local_thread_catalog WHERE thread_id = ?2",
                params![provider, id], |row| row.get::<_, bool>(0),
            ).optional().map_err(|error| error.to_string())?.unwrap_or(false);
            if differs {
                changed += 1;
                if !dry_run {
                    connection.execute("UPDATE local_thread_catalog SET model_provider = ?1 WHERE thread_id = ?2", params![provider, id])
                        .map_err(|error| error.to_string())?;
                }
            }
        }
    }
    Ok(changed)
}

pub(crate) fn reconcile_codex_thread_visibility_blocking<R: Runtime>(
    app: tauri::AppHandle<R>,
    mode: String,
    session_ids: Option<Vec<String>>,
    dry_run: bool,
) -> Result<VisibilityReport, String> {
    let paths = resolve_paths(&app)?;
    let mode = if mode == "deep" { "deep" } else { "quick" }.to_string();
    let snapshots = gather_snapshots(&paths.codex_home)?;
    let selected = session_ids
        .map(normalized_ids)
        .filter(|values| !values.is_empty());
    let relevant = snapshots
        .iter()
        .filter(|item| {
            selected
                .as_ref()
                .is_none_or(|ids| ids.contains(&item.session_id))
        })
        .collect::<Vec<_>>();
    let provider = current_model_provider(&paths.current_config);
    let state_db = latest_state_db(&paths.codex_home);
    let backup = if dry_run {
        None
    } else {
        create_visibility_checkpoint(&app, &paths.codex_home, state_db.as_deref(), &relevant)?
    };
    let database_row_count = state_db
        .as_deref()
        .map(|path| update_main_state(path, &provider, selected.as_ref(), dry_run))
        .transpose()?
        .unwrap_or(0);
    let relevant_ids = relevant
        .iter()
        .map(|item| item.session_id.clone())
        .collect::<HashSet<_>>();
    let catalog_row_count = update_catalogs(&paths.codex_home, &provider, &relevant_ids, dry_run)?;
    let mut rollout_count = 0usize;
    if !dry_run {
        for snapshot in &relevant {
            rollout_count += usize::from(rewrite_rollout_provider(&snapshot.path, &provider)?);
        }
    } else {
        rollout_count = relevant
            .iter()
            .filter(|item| {
                first_rollout_value(&item.path)
                    .ok()
                    .flatten()
                    .and_then(|value| {
                        value
                            .pointer("/payload/model_provider")
                            .and_then(Value::as_str)
                            .map(str::to_string)
                    })
                    .is_some_and(|value| value != provider)
            })
            .count();
    }
    let index_entry_count = if mode == "deep" && !dry_run {
        rebuild_index_from_snapshots(&paths.codex_home, &snapshots)?
    } else if mode == "deep" {
        snapshots.len()
    } else {
        0
    };
    let changed = database_row_count + catalog_row_count + rollout_count;
    Ok(VisibilityReport {
        mode,
        scanned_count: relevant.len(),
        rollout_count,
        database_row_count,
        catalog_row_count,
        index_entry_count,
        backup_dir: backup.map(|path| path.to_string_lossy().to_string()),
        dry_run,
        message: if dry_run {
            format!("预计校正 {changed} 处会话可见性记录")
        } else {
            format!("已校正 {changed} 处会话可见性记录")
        },
    })
}

pub(crate) fn rebuild_codex_thread_index_blocking<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<VisibilityReport, String> {
    let paths = resolve_paths(&app)?;
    let snapshots = gather_snapshots(&paths.codex_home)?;
    let backup = create_visibility_checkpoint(&app, &paths.codex_home, None, &[])?;
    let count = rebuild_index_from_snapshots(&paths.codex_home, &snapshots)?;
    Ok(VisibilityReport {
        mode: "sync".to_string(),
        scanned_count: snapshots.len(),
        rollout_count: 0,
        database_row_count: 0,
        catalog_row_count: 0,
        index_entry_count: count,
        backup_dir: backup.map(|path| path.to_string_lossy().to_string()),
        dry_run: false,
        message: format!("已同步 {} 条会话索引", count),
    })
}

pub(crate) fn open_codex_thread_file_blocking<R: Runtime>(
    app: tauri::AppHandle<R>,
    session_id: String,
    folder_only: bool,
) -> Result<(), String> {
    let codex_home = resolve_paths(&app)?.codex_home;
    let snapshot = gather_snapshots(&codex_home)?
        .into_iter()
        .find(|item| item.session_id == session_id)
        .ok_or_else(|| "未找到所选会话文件".to_string())?;
    let path = if folder_only {
        snapshot.path.parent().unwrap_or(&codex_home).to_path_buf()
    } else {
        snapshot.path
    };
    app.opener()
        .open_path(path.to_string_lossy().to_string(), None::<&str>)
        .map_err(|error| format!("无法打开 {}：{error}", path.display()))
}

#[tauri::command]
pub(crate) async fn browse_codex_threads<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    title_query: Option<String>,
    content_query: Option<String>,
) -> Result<Vec<ThreadEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        browse_codex_threads_blocking(app, title_query, content_query)
    })
    .await
    .map_err(|error| format!("Browse conversations task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn measure_codex_thread_tokens<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    session_ids: Vec<String>,
) -> Result<Vec<ThreadTokenTotals>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        measure_codex_thread_tokens_blocking(app, session_ids)
    })
    .await
    .map_err(|error| format!("Measure conversation tokens task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn discard_codex_threads<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    session_ids: Vec<String>,
) -> Result<MutationReport, String> {
    tauri::async_runtime::spawn_blocking(move || discard_codex_threads_blocking(app, session_ids))
        .await
        .map_err(|error| format!("Discard conversations task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn browse_codex_thread_bin<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
) -> Result<Vec<BinEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || browse_codex_thread_bin_blocking(app))
        .await
        .map_err(|error| format!("Browse conversation bin task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn recover_codex_threads<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    session_ids: Vec<String>,
) -> Result<MutationReport, String> {
    tauri::async_runtime::spawn_blocking(move || recover_codex_threads_blocking(app, session_ids))
        .await
        .map_err(|error| format!("Recover conversations task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn purge_codex_threads<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    session_ids: Vec<String>,
) -> Result<MutationReport, String> {
    tauri::async_runtime::spawn_blocking(move || purge_codex_threads_blocking(app, session_ids))
        .await
        .map_err(|error| format!("Purge conversations task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn empty_codex_thread_bin<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
) -> Result<MutationReport, String> {
    tauri::async_runtime::spawn_blocking(move || empty_codex_thread_bin_blocking(app))
        .await
        .map_err(|error| format!("Empty conversation bin task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn inspect_codex_thread_export<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    session_ids: Vec<String>,
) -> Result<BundlePreview, String> {
    tauri::async_runtime::spawn_blocking(move || {
        inspect_codex_thread_export_blocking(app, session_ids)
    })
    .await
    .map_err(|error| format!("Inspect conversation export task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn pack_codex_threads<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    session_ids: Vec<String>,
    export_path: String,
) -> Result<BundleResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        pack_codex_threads_blocking(app, session_ids, export_path)
    })
    .await
    .map_err(|error| format!("Pack conversations task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn inspect_codex_thread_import<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    import_path: String,
) -> Result<BundlePreview, String> {
    tauri::async_runtime::spawn_blocking(move || {
        inspect_codex_thread_import_blocking(app, import_path)
    })
    .await
    .map_err(|error| format!("Inspect conversation import task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn unpack_codex_threads<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    import_path: String,
    session_ids: Vec<String>,
) -> Result<BundleResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        unpack_codex_threads_blocking(app, import_path, session_ids)
    })
    .await
    .map_err(|error| format!("Unpack conversations task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn reconcile_codex_thread_visibility<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    mode: String,
    session_ids: Option<Vec<String>>,
    dry_run: bool,
) -> Result<VisibilityReport, String> {
    tauri::async_runtime::spawn_blocking(move || {
        reconcile_codex_thread_visibility_blocking(app, mode, session_ids, dry_run)
    })
    .await
    .map_err(|error| format!("Reconcile conversation visibility task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn rebuild_codex_thread_index<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
) -> Result<VisibilityReport, String> {
    tauri::async_runtime::spawn_blocking(move || rebuild_codex_thread_index_blocking(app))
        .await
        .map_err(|error| format!("Rebuild conversation index task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn open_codex_thread_file<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    session_id: String,
    folder_only: bool,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        open_codex_thread_file_blocking(app, session_id, folder_only)
    })
    .await
    .map_err(|error| format!("Open conversation file task failed: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_root(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "codex-switch-thread-test-{label}-{}",
            Uuid::new_v4()
        ))
    }

    #[test]
    fn scans_rollouts_with_index_titles() {
        let root = test_root("scan");
        let session_dir = root.join("sessions/2026/08/08");
        fs::create_dir_all(&session_dir).unwrap();
        fs::write(
            session_dir.join("rollout-thread-a.jsonl"),
            r#"{"timestamp":"2026-08-08T10:00:00Z","type":"session_meta","payload":{"id":"thread-a","cwd":"F:\\projects\\alpha","model_provider":"openai"}}
{"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":10,"output_tokens":5,"total_tokens":15}}}}
{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"Please inspect the Alpha search result carefully."}]}}
"#,
        )
        .unwrap();
        fs::write(
            root.join(INDEX_NAME),
            r#"{"id":"thread-a","thread_name":"Alpha session","updated_at":"2026-08-08T10:30:00Z"}
"#,
        )
        .unwrap();

        let snapshots = gather_snapshots(&root).unwrap();
        assert_eq!(snapshots.len(), 1);
        assert_eq!(snapshots[0].session_id, "thread-a");
        assert_eq!(snapshots[0].title, "Alpha session");
        assert_eq!(snapshots[0].cwd, r#"F:\projects\alpha"#);
        assert_eq!(token_totals(&snapshots[0].path), Some((10, 5, 15)));
        assert_eq!(
            locate_rollout_text(&snapshots[0].path, "alpha")
                .unwrap()
                .as_deref(),
            Some("Please inspect the Alpha search result carefully.")
        );
        assert!(locate_rollout_text(&snapshots[0].path, "missing")
            .unwrap()
            .is_none());

        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn package_paths_cannot_escape_codex_home() {
        assert!(safe_relative_path("sessions/2026/rollout-a.jsonl").is_some());
        assert!(safe_relative_path("").is_none());
        assert!(safe_relative_path("../auth.json").is_none());
        assert!(safe_relative_path("/outside/rollout.jsonl").is_none());
        assert!(safe_relative_path("C:/outside/rollout.jsonl").is_none());
        assert!(safe_relative_path(r"C:\outside\rollout.jsonl").is_none());
        assert!(safe_relative_path("C:outside/rollout.jsonl").is_none());
        assert!(safe_relative_path(r"\\server\share\rollout.jsonl").is_none());
    }

    #[test]
    fn scans_searches_and_rewrites_compressed_rollouts() {
        let root = test_root("compressed");
        let session_dir = root.join("sessions/2026/08/09");
        fs::create_dir_all(&session_dir).unwrap();
        let rollout = session_dir.join("rollout-thread-z.jsonl.zst");
        let source = r#"{"timestamp":"2026-08-09T10:00:00Z","type":"session_meta","payload":{"id":"thread-z","cwd":"F:\\projects\\zeta","model_provider":"openai"}}
{"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":20,"output_tokens":7,"total_tokens":27}}}}
{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"Compressed Zeta history"}]}}
"#;
        let output = File::create(&rollout).unwrap();
        let mut encoder = zstd::stream::write::Encoder::new(output, 3).unwrap();
        encoder.write_all(source.as_bytes()).unwrap();
        encoder.finish().unwrap();

        let snapshots = gather_snapshots(&root).unwrap();
        assert_eq!(snapshots.len(), 1);
        assert_eq!(snapshots[0].path, rollout);
        assert_eq!(token_totals(&snapshots[0].path), Some((20, 7, 27)));
        assert_eq!(
            locate_rollout_text(&snapshots[0].path, "zeta")
                .unwrap()
                .as_deref(),
            Some("Compressed Zeta history")
        );

        assert!(rewrite_rollout_provider(&snapshots[0].path, "custom").unwrap());
        let meta = first_rollout_value(&snapshots[0].path).unwrap().unwrap();
        assert_eq!(meta["payload"]["model_provider"], "custom");
        assert!(locate_rollout_text(&snapshots[0].path, "compressed")
            .unwrap()
            .is_some());

        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn recycle_visibility_roundtrips_the_codex_state_row() {
        let root = test_root("state-visibility");
        fs::create_dir_all(&root).unwrap();
        let state_db = root.join("state_5.sqlite");
        let connection = Connection::open(&state_db).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE threads (
                    id TEXT PRIMARY KEY,
                    rollout_path TEXT NOT NULL,
                    archived INTEGER NOT NULL,
                    archived_at INTEGER,
                    preview TEXT NOT NULL
                );",
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO threads (id, rollout_path, archived, archived_at, preview) VALUES (?1, ?2, 0, NULL, ?3)",
                params!["thread-a", "sessions/rollout-thread-a.jsonl", "Visible thread"],
            )
            .unwrap();
        drop(connection);

        let visibility = state_visibility_snapshot(Some(&state_db), "thread-a")
            .unwrap()
            .unwrap();
        hide_thread_in_state(
            Some(&state_db),
            "thread-a",
            &root.join("bin/rollout-thread-a.jsonl"),
        )
        .unwrap();
        let hidden = state_visibility_snapshot(Some(&state_db), "thread-a")
            .unwrap()
            .unwrap();
        assert_eq!(hidden.archived, 1);
        assert!(hidden.preview.is_empty());

        restore_thread_visibility(Some(&state_db), "thread-a", Some(&visibility)).unwrap();
        let restored = state_visibility_snapshot(Some(&state_db), "thread-a")
            .unwrap()
            .unwrap();
        assert_eq!(restored.archived, 0);
        assert_eq!(restored.preview, "Visible thread");
        assert_eq!(restored.rollout_path, "sessions/rollout-thread-a.jsonl");

        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn related_sqlite_state_roundtrips_for_import() {
        let source = test_root("related-state-source");
        let target = test_root("related-state-target");
        fs::create_dir_all(&source).unwrap();
        fs::create_dir_all(&target).unwrap();

        for root in [&source, &target] {
            Connection::open(root.join("state_2.sqlite"))
                .unwrap()
                .execute_batch(
                    "CREATE TABLE threads (id TEXT PRIMARY KEY, rollout_path TEXT NOT NULL);
                     CREATE TABLE thread_dynamic_tools (
                         thread_id TEXT NOT NULL, position INTEGER NOT NULL, name TEXT NOT NULL,
                         PRIMARY KEY (thread_id, position)
                     );
                     CREATE TABLE thread_spawn_edges (
                         parent_thread_id TEXT NOT NULL, child_thread_id TEXT PRIMARY KEY, status TEXT NOT NULL
                     );",
                )
                .unwrap();
            Connection::open(root.join("thread_history_3.sqlite"))
                .unwrap()
                .execute_batch(
                    "CREATE TABLE thread_turns (
                         thread_id TEXT NOT NULL, turn_id TEXT NOT NULL,
                         PRIMARY KEY (thread_id, turn_id)
                     );
                     CREATE TABLE thread_items (
                         thread_id TEXT NOT NULL, turn_id TEXT NOT NULL, item_id TEXT NOT NULL,
                         PRIMARY KEY (thread_id, turn_id, item_id)
                     );
                     CREATE TABLE thread_history_projection_state (
                         thread_id TEXT PRIMARY KEY, next_rollout_ordinal INTEGER NOT NULL
                     );",
                )
                .unwrap();
            Connection::open(root.join("queue_1.sqlite"))
                .unwrap()
                .execute_batch(
                    "CREATE TABLE queued_items (
                         id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, payload_json TEXT NOT NULL
                     );",
                )
                .unwrap();
        }

        Connection::open(source.join("state_2.sqlite"))
            .unwrap()
            .execute_batch(
                "INSERT INTO threads VALUES ('thread-a', 'sessions/source.jsonl');
                 INSERT INTO thread_dynamic_tools VALUES ('thread-a', 0, 'tool-a');
                 INSERT INTO thread_spawn_edges VALUES ('thread-a', 'thread-b', 'completed');",
            )
            .unwrap();
        Connection::open(source.join("thread_history_3.sqlite"))
            .unwrap()
            .execute_batch(
                "INSERT INTO thread_turns VALUES ('thread-a', 'turn-a');
                 INSERT INTO thread_items VALUES ('thread-a', 'turn-a', 'item-a');
                 INSERT INTO thread_history_projection_state VALUES ('thread-a', 7);",
            )
            .unwrap();
        Connection::open(source.join("queue_1.sqlite"))
            .unwrap()
            .execute(
                "INSERT INTO queued_items VALUES ('queue-a', 'thread-a', '{}')",
                [],
            )
            .unwrap();

        let thread_row =
            snapshot_thread_row(latest_state_db(&source).as_deref(), "thread-a").unwrap();
        restore_thread_row(
            latest_state_db(&target).as_deref(),
            thread_row.as_ref(),
            &target.join("sessions/rollout-thread-a.jsonl.zst"),
            "thread-a",
        )
        .unwrap();
        let included = HashSet::from(["thread-a".to_string(), "thread-b".to_string()]);
        let related = snapshot_related_state(&source, "thread-a", &included).unwrap();
        restore_related_state(&target, &related, "thread-a").unwrap();

        let state = Connection::open(target.join("state_2.sqlite")).unwrap();
        let restored_path: String = state
            .query_row(
                "SELECT rollout_path FROM threads WHERE id = 'thread-a'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(restored_path.ends_with("rollout-thread-a.jsonl"));
        assert_eq!(
            state
                .query_row(
                    "SELECT COUNT(*) FROM thread_dynamic_tools WHERE thread_id = 'thread-a'",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            1
        );
        assert_eq!(
            state
                .query_row(
                    "SELECT COUNT(*) FROM thread_spawn_edges WHERE parent_thread_id = 'thread-a'",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            1
        );
        assert_eq!(
            Connection::open(target.join("thread_history_3.sqlite"))
                .unwrap()
                .query_row(
                    "SELECT COUNT(*) FROM thread_items WHERE thread_id = 'thread-a'",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            1
        );
        assert_eq!(
            Connection::open(target.join("queue_1.sqlite"))
                .unwrap()
                .query_row(
                    "SELECT COUNT(*) FROM queued_items WHERE thread_id = 'thread-a'",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            1
        );

        drop(state);
        fs::remove_dir_all(source).unwrap();
        fs::remove_dir_all(target).unwrap();
    }
}
