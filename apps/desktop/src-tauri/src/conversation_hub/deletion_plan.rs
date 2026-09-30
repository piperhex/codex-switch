use super::*;

#[derive(Debug, thiserror::Error)]
pub(crate) enum DeletionError {
    #[error("对话暂时无法删除，请刷新后重试。")]
    Changed,
    #[error("部分子对话的记录不完整，请先在会话管理中恢复后再删除。")]
    MissingHistory,
    #[error("Could not move conversation tree to trash: {0}")]
    Storage(String),
}

impl From<String> for DeletionError {
    fn from(value: String) -> Self {
        Self::Storage(value)
    }
}

/// A fixed selection that can be checked for active work before any files are moved.
pub(crate) struct DeletionPlan {
    root_id: String,
    pub(crate) thread_ids: Vec<String>,
}

/// Discover descendants from both rollout history and the engine's spawn relations.
pub(crate) fn prepare<R: Runtime>(
    context: &ThreadContext<R>,
    root_id: String,
) -> Result<DeletionPlan, DeletionError> {
    plan(&context.paths.codex_home, root_id)
}

fn plan(home: &Path, root_id: String) -> Result<DeletionPlan, DeletionError> {
    let snapshots = gather_snapshots(home)?;
    plan_from_snapshots(home, root_id, &snapshots)
}

fn plan_from_snapshots(
    home: &Path,
    root_id: String,
    snapshots: &[RolloutSnapshot],
) -> Result<DeletionPlan, DeletionError> {
    let edges = super::thread_relations::edges(home, snapshots)?;
    let selected = descendants(&root_id, &edges);
    let available: HashSet<_> = snapshots.iter().map(|item| &item.session_id).collect();
    if selected.iter().any(|id| !available.contains(id)) {
        return Err(DeletionError::MissingHistory);
    }
    let mut thread_ids: Vec<_> = selected.into_iter().collect();
    thread_ids.sort();
    Ok(DeletionPlan {
        root_id,
        thread_ids,
    })
}

fn descendants(root_id: &str, edges: &[(String, String)]) -> HashSet<String> {
    let mut children: HashMap<&str, Vec<&str>> = HashMap::new();
    for (parent, child) in edges {
        children.entry(parent).or_default().push(child);
    }
    let mut selected = HashSet::new();
    let mut pending = vec![root_id];
    while let Some(id) = pending.pop() {
        if selected.insert(id.to_string()) {
            pending.extend(children.get(id).into_iter().flatten().copied());
        }
    }
    selected
}

/// Recheck the exact selection under the bin guard; never delete a new, unchecked child.
pub(crate) fn discard<R: Runtime>(
    context: ThreadContext<R>,
    checked: DeletionPlan,
) -> Result<MutationReport, DeletionError> {
    let _guard = bin_operation_guard()?;
    let home = &context.paths.codex_home;
    let snapshots = checked_snapshots(home, &checked)?;
    super::deletion_batch::discard(home, &bin_root(&context)?, snapshots)?;
    Ok(MutationReport {
        requested_count: 1,
        affected_count: checked.thread_ids.len(),
        released_bytes: 0,
        message: format!("已将 {} 条对话移入回收站", checked.thread_ids.len()),
    })
}

fn checked_snapshots(
    home: &Path,
    checked: &DeletionPlan,
) -> Result<Vec<RolloutSnapshot>, DeletionError> {
    let all = gather_snapshots(home)?;
    let current = plan_from_snapshots(home, checked.root_id.clone(), &all)?;
    if current.thread_ids != checked.thread_ids {
        return Err(DeletionError::Changed);
    }
    let selected: HashSet<_> = checked.thread_ids.iter().cloned().collect();
    ensure_threads_are_not_referenced(&all, &selected, latest_state_db(home).as_deref())?;
    Ok(merge_bin_snapshots(
        all.into_iter()
            .filter(|item| selected.contains(&item.session_id))
            .collect(),
    ))
}

#[cfg(test)]
#[path = "deletion_plan_tests.rs"]
mod tests;
