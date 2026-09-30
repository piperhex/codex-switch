use super::*;

#[derive(Debug, thiserror::Error)]
pub(super) enum MigrationPlanError {
    #[error("required conversation history is missing")]
    MissingHistory,
    #[error("{0}")]
    Storage(String),
}

impl From<String> for MigrationPlanError {
    fn from(error: String) -> Self {
        Self::Storage(error)
    }
}

/// A migration includes connected, available sessions so hidden descendants do
/// not force users to find and select every thread by hand.
pub(super) fn plan_home_migration(
    source: &Path,
    target: &Path,
    requested: &HashSet<String>,
) -> Result<Vec<RolloutSnapshot>, MigrationPlanError> {
    let all = merge_bin_snapshots(gather_snapshots(source)?);
    let edges = super::thread_relations::edges(source, &all)?;
    let selected = connected_sessions(&all, &edges, requested);
    let existing = target_session_ids(target)?;
    let target_history = live_bin_thread_ids(target)?;
    let mut moving = HashSet::new();
    for item in &all {
        if selected.contains(&item.session_id)
            && !existing.contains(&item.session_id)
            && !has_target_path(item, source, target)?
        {
            moving.insert(item.session_id.clone());
        }
    }
    retain_required_source_history(&all, &mut moving);
    for item in all.iter().filter(|item| moving.contains(&item.session_id)) {
        if let Some(base) = &item.history_base_thread_id {
            if !moving.contains(base) && !target_history.contains(base) {
                return Err(MigrationPlanError::MissingHistory);
            }
        }
    }
    let mut planned = all
        .into_iter()
        .filter(|item| moving.contains(&item.session_id))
        .collect::<Vec<_>>();
    planned.sort_by(|left, right| left.session_id.cmp(&right.session_id));
    Ok(planned)
}

pub(super) fn target_session_ids(home: &Path) -> Result<HashSet<String>, String> {
    let mut ids = live_bin_thread_ids(home)?;
    if let Some(path) = latest_state_db(home) {
        let connection = Connection::open(path).map_err(|error| error.to_string())?;
        let mut statement = connection
            .prepare("SELECT id FROM threads")
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|error| error.to_string())?;
        ids.extend(
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|error| error.to_string())?,
        );
    }
    Ok(ids)
}

fn has_target_path(item: &RolloutSnapshot, source: &Path, target: &Path) -> Result<bool, String> {
    for path in &item.physical_paths {
        if target.join(bin_rollout_relative(path, source)?).exists() {
            return Ok(true);
        }
    }
    Ok(false)
}

fn connected_sessions(
    all: &[RolloutSnapshot],
    edges: &[(String, String)],
    requested: &HashSet<String>,
) -> HashSet<String> {
    let available = all
        .iter()
        .map(|item| item.session_id.clone())
        .collect::<HashSet<_>>();
    let mut selected = requested
        .intersection(&available)
        .cloned()
        .collect::<HashSet<_>>();
    loop {
        let previous = selected.len();
        for (parent, child) in edges {
            if available.contains(parent)
                && available.contains(child)
                && (selected.contains(parent) || selected.contains(child))
            {
                selected.extend([parent.clone(), child.clone()]);
            }
        }
        if selected.len() == previous {
            return selected;
        }
    }
}

fn retain_required_source_history(all: &[RolloutSnapshot], moving: &mut HashSet<String>) {
    loop {
        let required = all
            .iter()
            .filter(|item| !moving.contains(&item.session_id))
            .flat_map(|item| [&item.history_base_thread_id, &item.parent_thread_id])
            .flatten()
            .cloned()
            .collect::<HashSet<_>>();
        let previous = moving.len();
        moving.retain(|id| !required.contains(id));
        if previous == moving.len() {
            return;
        }
    }
}
