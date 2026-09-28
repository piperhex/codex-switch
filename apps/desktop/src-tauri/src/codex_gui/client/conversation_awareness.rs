use futures_util::future::join_all;
use serde_json::{json, Value};
use tokio::time::{timeout, Duration};

use super::Client;
use crate::codex_gui::{
    conversation_context as context,
    error::{GuiError, Result},
    workspaces,
};

const SNAPSHOT_TIMEOUT: Duration = Duration::from_secs(5);

impl Client {
    pub(super) async fn prepare_conversation_context(&self, params: &mut Value) -> Result<()> {
        let references = context::references(params)?;
        let count = references.len();
        // Read each source without resuming it or changing its running turn.
        let snapshots = join_all(references.iter().map(|id| async move {
            let thread = self
                .context_thread(id, true)
                .await
                .map_err(|_| GuiError::ConversationReference)?;
            context::reference(&thread, count)
        }))
        .await
        .into_iter()
        .collect::<Result<Vec<_>>>()?;
        let current = params["threadId"]
            .as_str()
            .ok_or(GuiError::InvalidRequest)?;
        // Release the shared state before any network wait.
        let mut active: Vec<_> = self
            .active_turns
            .lock()
            .await
            .keys()
            .filter(|id| id.as_str() != current)
            .cloned()
            .collect();
        active.sort();
        let total = active.len();
        active.truncate(context::MAX_RUNNING);
        let running = join_all(active.iter().map(|id| async move {
            // A just-created running thread may not have persisted history yet; its ID remains useful.
            let thread = self.context_thread(id, false).await.unwrap_or(Value::Null);
            context::summary(id, &thread)
        }))
        .await;
        context::append(params, snapshots, running, total)
    }

    async fn context_thread(&self, id: &str, include_turns: bool) -> Result<Value> {
        let mut response = timeout(
            SNAPSHOT_TIMEOUT,
            self.request_raw(
                "thread/read",
                json!({"threadId": id, "includeTurns": include_turns}),
            ),
        )
        .await
        .map_err(|_| GuiError::Timeout)??;
        workspaces::hide_project_paths(&mut response, &self.projectless_root);
        if response["thread"]["id"] != id {
            return Err(GuiError::ConversationReference);
        }
        Ok(response["thread"].take())
    }
}
