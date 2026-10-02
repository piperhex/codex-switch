//! Only completed structured edits authorize previews outside a conversation's workspace.
use serde_json::Value;
use std::path::Path;

pub(super) fn changed_files(thread: &Value) -> Vec<&str> {
    thread["turns"]
        .as_array()
        .into_iter()
        .flatten()
        .flat_map(|turn| turn["items"].as_array().into_iter().flatten())
        .filter(|item| item["type"] == "fileChange" && item["status"] == "completed")
        .flat_map(|item| item["changes"].as_array().into_iter().flatten())
        .filter_map(current_path)
        .collect()
}

fn current_path(change: &Value) -> Option<&str> {
    match change["kind"]["type"].as_str()? {
        "add" => change["path"].as_str(),
        "update" => change["kind"]["movePath"]
            .as_str()
            .or_else(|| change["path"].as_str()),
        _ => None,
    }
}

pub(super) fn matches_file(path: &Path, root: &Path, references: &[&str]) -> bool {
    // A recorded edit grants access to that exact file, never siblings or message-supplied paths.
    references.iter().any(|source| {
        super::validate_path(source).is_ok()
            && root
                .join(source)
                .canonicalize()
                .is_ok_and(|reference| reference == path)
    })
}
