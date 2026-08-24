use crate::models::ManagerStateFile;
use crate::storage::{read_json, write_state, Paths};

fn account_email_by_id(paths: &Paths) -> HashMap<String, String> {
    let Ok(entries) = fs::read_dir(&paths.accounts) else {
        return HashMap::new();
    };
    entries
        .filter_map(Result::ok)
        .filter(|entry| entry.path().is_dir())
        .filter_map(|entry| {
            let auth = read_json(&entry.path().join("auth.json")).ok()?;
            let (email, _, _, id) = crate::auth::account_fields(&auth).ok()?;
            Some((id, email))
        })
        .collect()
}

fn assign_unowned_threads(
    snapshots: &[RolloutSnapshot],
    state: &mut ManagerStateFile,
    account_id: Option<&str>,
) -> bool {
    let Some(account_id) = account_id else {
        return false;
    };
    let mut changed = false;
    for snapshot in snapshots {
        if state
            .conversation_account_ids
            .contains_key(&snapshot.session_id)
        {
            continue;
        }
        state
            .conversation_account_ids
            .insert(snapshot.session_id.clone(), account_id.to_string());
        changed = true;
    }
    changed
}

fn observe_threads(
    snapshots: &[RolloutSnapshot],
    state: &mut ManagerStateFile,
    assign_new_to: Option<&str>,
) -> bool {
    let mut changed = false;
    let initial_scan = !state.conversation_ownership_initialized;
    for snapshot in snapshots {
        let first_seen = state
            .observed_conversation_ids
            .insert(snapshot.session_id.clone());
        changed |= first_seen;
        if !initial_scan && first_seen {
            changed |= assign_unowned_threads(
                std::slice::from_ref(snapshot),
                state,
                assign_new_to,
            );
        }
    }
    if initial_scan {
        state.conversation_ownership_initialized = true;
        changed = true;
    }
    changed
}

fn sync_thread_ownership(
    paths: &Paths,
    snapshots: &[RolloutSnapshot],
) -> Result<ManagerStateFile, String> {
    let mut state = crate::storage::read_state(paths);
    let active_account_id = state.active_account_id.clone();
    if observe_threads(
        snapshots,
        &mut state,
        active_account_id.as_deref(),
    ) {
        write_state(paths, &state)?;
    }
    Ok(state)
}

pub(crate) fn mark_threads_before_account_switch(
    paths: &Paths,
    state: &mut ManagerStateFile,
    previous_account_id: Option<&str>,
) -> Result<(), String> {
    let Some(previous_account_id) = previous_account_id else {
        return Ok(());
    };
    let snapshots = gather_snapshots(&paths.codex_home)?;
    observe_threads(&snapshots, state, Some(previous_account_id));
    Ok(())
}
