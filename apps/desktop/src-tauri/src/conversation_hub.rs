use std::{
    collections::{HashMap, HashSet},
    fs::{self, File},
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension};
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
    relative_path: PathBuf,
    index_value: Value,
    size_bytes: u64,
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
}

#[derive(Debug, Clone)]
struct BinSnapshot {
    folder: PathBuf,
    manifest: BinManifest,
    rollout: PathBuf,
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
        } else if path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.starts_with("rollout-") && name.ends_with(".jsonl"))
        {
            result.push(path);
        }
    }
    Ok(())
}

fn first_rollout_value(path: &Path) -> Result<Option<Value>, String> {
    let file = File::open(path)
        .map_err(|error| format!("无法打开会话文件 {}：{error}", path.display()))?;
    for line in BufReader::new(file).lines() {
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

fn gather_snapshots(codex_home: &Path) -> Result<Vec<RolloutSnapshot>, String> {
    let index = index_values(codex_home)?;
    let mut files = Vec::new();
    for folder in ROLLOUT_FOLDERS {
        collect_rollout_paths(&codex_home.join(folder), &mut files)?;
    }
    files.sort();
    let mut snapshots = Vec::new();
    for path in files {
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
        let size_bytes = fs::metadata(&path).map(|item| item.len()).unwrap_or(0);
        snapshots.push(RolloutSnapshot {
            session_id,
            title,
            cwd,
            updated_at,
            path,
            relative_path,
            index_value,
            size_bytes,
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
    let file = File::open(path)
        .map_err(|error| format!("无法打开会话文件 {}：{error}", path.display()))?;
    for line in BufReader::new(file).lines() {
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

#[tauri::command]
pub(crate) fn browse_codex_threads<R: Runtime>(
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
            Some(query) => match locate_rollout_text(&snapshot.path, query)? {
                Some(value) => Some(value),
                None => None,
            },
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
    let file = File::open(path).ok()?;
    let mut latest = None;
    for line in BufReader::new(file).lines().map_while(Result::ok) {
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

#[tauri::command]
pub(crate) fn measure_codex_thread_tokens<R: Runtime>(
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

#[tauri::command]
pub(crate) fn discard_codex_threads<R: Runtime>(
    app: tauri::AppHandle<R>,
    session_ids: Vec<String>,
) -> Result<MutationReport, String> {
    let requested = normalized_ids(session_ids);
    if requested.is_empty() {
        return Err("请至少选择一条会话".to_string());
    }
    let paths = resolve_paths(&app)?;
    let snapshots = gather_snapshots(&paths.codex_home)?
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
        fs::create_dir_all(target.parent().unwrap_or(&folder))
            .map_err(|error| format!("无法创建回收站条目：{error}"))?;
        let manifest = BinManifest {
            session_id: snapshot.session_id.clone(),
            title: snapshot.title,
            cwd: snapshot.cwd,
            original_rollout_path: snapshot.path.clone(),
            relative_rollout_path: snapshot.relative_path.to_string_lossy().to_string(),
            session_index_entry: snapshot.index_value,
            deleted_at: Utc::now().to_rfc3339(),
        };
        let manifest_text = serde_json::to_string_pretty(&manifest)
            .map_err(|error| format!("无法生成回收站清单：{error}"))?;
        write_text_atomic(&folder.join("manifest.json"), &format!("{manifest_text}\n"))?;
        fs::rename(&snapshot.path, &target).map_err(|error| {
            format!("无法将会话移入回收站 {}：{error}", snapshot.path.display())
        })?;
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
            let rollout = folder.join("files").join(&manifest.relative_rollout_path);
            if rollout.is_file() {
                result.push(BinSnapshot {
                    folder,
                    manifest,
                    rollout,
                });
            }
        }
    }
    Ok(result)
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

#[tauri::command]
pub(crate) fn browse_codex_thread_bin<R: Runtime>(
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

#[tauri::command]
pub(crate) fn recover_codex_threads<R: Runtime>(
    app: tauri::AppHandle<R>,
    session_ids: Vec<String>,
) -> Result<MutationReport, String> {
    let requested = normalized_ids(session_ids);
    if requested.is_empty() {
        return Err("请至少选择一条待恢复会话".to_string());
    }
    let codex_home = resolve_paths(&app)?.codex_home;
    let mut restored = HashSet::new();
    for item in collect_bin_entries(&app)?
        .into_iter()
        .filter(|item| requested.contains(&item.manifest.session_id))
    {
        let target = if item.manifest.original_rollout_path.starts_with(&codex_home) {
            item.manifest.original_rollout_path.clone()
        } else {
            codex_home.join(&item.manifest.relative_rollout_path)
        };
        if target.exists() {
            continue;
        }
        fs::create_dir_all(target.parent().unwrap_or(&codex_home))
            .map_err(|error| format!("无法创建会话目录：{error}"))?;
        fs::rename(&item.rollout, &target)
            .map_err(|error| format!("无法恢复会话 {}：{error}", item.manifest.session_id))?;
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

#[tauri::command]
pub(crate) fn purge_codex_threads<R: Runtime>(
    app: tauri::AppHandle<R>,
    session_ids: Vec<String>,
) -> Result<MutationReport, String> {
    let requested = normalized_ids(session_ids);
    if requested.is_empty() {
        return Err("请至少选择一条要永久删除的会话".to_string());
    }
    delete_bin_items(&app, Some(&requested))
}

#[tauri::command]
pub(crate) fn empty_codex_thread_bin<R: Runtime>(
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

#[tauri::command]
pub(crate) fn inspect_codex_thread_export<R: Runtime>(
    app: tauri::AppHandle<R>,
    session_ids: Vec<String>,
) -> Result<BundlePreview, String> {
    let requested = normalized_ids(session_ids);
    if requested.is_empty() {
        return Err("请至少选择一条会话".to_string());
    }
    let items = selected_snapshots(&resolve_paths(&app)?.codex_home, &requested)?
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

#[tauri::command]
pub(crate) fn pack_codex_threads<R: Runtime>(
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

#[tauri::command]
pub(crate) fn inspect_codex_thread_import<R: Runtime>(
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
    let path = PathBuf::from(normalized);
    (!path.is_absolute()
        && path
            .components()
            .all(|part| matches!(part, std::path::Component::Normal(_))))
    .then_some(path)
}

#[tauri::command]
pub(crate) fn unpack_codex_threads<R: Runtime>(
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
    let source = File::open(path).map_err(|error| error.to_string())?;
    let mut reader = BufReader::new(source);
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
    let mut output = File::create(&temporary).map_err(|error| error.to_string())?;
    serde_json::to_writer(&mut output, &meta).map_err(|error| error.to_string())?;
    output.write_all(b"\n").map_err(|error| error.to_string())?;
    std::io::copy(&mut reader, &mut output).map_err(|error| error.to_string())?;
    output.sync_all().map_err(|error| error.to_string())?;
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

#[tauri::command]
pub(crate) fn reconcile_codex_thread_visibility<R: Runtime>(
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

#[tauri::command]
pub(crate) fn rebuild_codex_thread_index<R: Runtime>(
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

#[tauri::command]
pub(crate) fn open_codex_thread_file<R: Runtime>(
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
        assert!(safe_relative_path("../auth.json").is_none());
        assert!(safe_relative_path("C:/outside/rollout.jsonl").is_none());
    }
}
