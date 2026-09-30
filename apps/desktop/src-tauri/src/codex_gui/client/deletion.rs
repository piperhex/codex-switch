use super::{idle_threads, Client, GuiError, Result};
use serde_json::{json, Value};
use tokio::sync::OwnedRwLockWriteGuard;

impl Client {
    /// Keep GUI mutations and idle cleanup out until the whole tree is in the trash.
    pub(in crate::codex_gui) async fn prepare_deletion(
        &self,
        ids: &[String],
    ) -> Result<Vec<OwnedRwLockWriteGuard<()>>> {
        let mut guards = Vec::new();
        for id in ids {
            guards.push(self.idle_threads.deletion_guard(id).await?);
        }
        if self
            .active_turns
            .lock()
            .await
            .keys()
            .any(|id| ids.contains(id))
            || self.approvals.lock().await.values().any(|event| {
                event.params["threadId"]
                    .as_str()
                    .is_some_and(|id| ids.iter().any(|selected| selected == id))
            })
        {
            return Err(GuiError::Busy);
        }
        release_tree(ids, |method, params| self.request_raw(method, params)).await?;
        Ok(guards)
    }
}

async fn release_tree<F, Fut>(ids: &[String], mut request: F) -> Result<()>
where
    F: FnMut(&'static str, Value) -> Fut,
    Fut: std::future::Future<Output = Result<Value>>,
{
    let mut loaded = Vec::new();
    for id in ids {
        match idle_threads::inspect_thread(id, &mut request).await? {
            idle_threads::ReleaseDecision::Wait => return Err(GuiError::Busy),
            idle_threads::ReleaseDecision::NotLoaded => {}
            idle_threads::ReleaseDecision::Unsubscribe => loaded.push(id),
        }
    }
    // No subscription changes until every descendant has passed the activity checks.
    for id in loaded {
        let result = request("thread/unsubscribe", json!({"threadId": id})).await?;
        if !idle_threads::released(&result) {
            return Err(GuiError::Busy);
        }
    }
    Ok(())
}

#[cfg(test)]
#[path = "deletion_tests.rs"]
mod tests;
