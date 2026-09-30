//! Keep complete GUI operations alive while an idle CLI replacement is considered.
use super::{Client, GuiError, GuiState, Result};
use std::{ops::Deref, sync::atomic::Ordering, sync::Arc};
use tokio::sync::OwnedRwLockReadGuard;

pub(super) struct Connection {
    client: Arc<Client>,
    _activity: OwnedRwLockReadGuard<()>,
}

impl Deref for Connection {
    type Target = Client;

    fn deref(&self) -> &Client {
        &self.client
    }
}

pub(super) async fn connected(state: &GuiState) -> Result<Connection> {
    let activity = state.activity.clone().read_owned().await;
    let client = state
        .client
        .lock()
        .await
        .as_ref()
        .filter(|client| client.alive.load(Ordering::Acquire))
        .cloned()
        .ok_or(GuiError::Disconnected)?;
    Ok(Connection {
        client,
        _activity: activity,
    })
}

#[cfg(test)]
mod tests {
    #[tokio::test]
    async fn update_skips_in_flight_operations_and_new_operations_wait_for_update() {
        let state = super::GuiState::default();
        let operation = state.activity.clone().read_owned().await;
        assert!(state.activity.try_write().is_err());
        drop(operation);
        let update = state.activity.try_write().unwrap();
        assert!(state.activity.try_read().is_err());
        drop(update);
        assert!(state.activity.try_read().is_ok());
    }
}
