use super::{
    authority::{Address, Grant},
    network, Error, Result, State,
};
use serde::Serialize;
use std::{collections::HashMap, sync::Arc};
use tauri::ipc::Channel;
use tokio::sync::{mpsc, oneshot, watch, Mutex};

pub(super) const MAX_SOCKETS: usize = 16;
pub(super) const MAX_BYTES: usize = 128 * 1024;

#[derive(Clone, Serialize)]
#[serde(
    tag = "type",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub(crate) enum Event {
    Open {
        socket_id: String,
        local_address: String,
        local_port: u16,
        incoming: bool,
    },
    Data {
        socket_id: String,
        data: Vec<u8>,
    },
    Closed {
        socket_id: String,
    },
}

pub(super) enum SocketCommand {
    Write(Vec<u8>, oneshot::Sender<()>),
    Ack,
    Close,
}
pub(super) struct Group {
    pub session: String,
    pub generation: u64,
    pub grant: Grant,
    pub cancel: watch::Sender<bool>,
    pub events: Channel<Event>,
    pub sockets: Mutex<HashMap<String, mpsc::Sender<SocketCommand>>>,
    pub listeners: Mutex<HashMap<bool, (u16, watch::Sender<bool>)>>,
}

impl State {
    pub(super) async fn open(
        &self,
        session: String,
        generation: u64,
        events: Channel<Event>,
    ) -> Result<String> {
        let authority = self.authority.clone();
        let checked_id = session.clone();
        let grant =
            tauri::async_runtime::spawn_blocking(move || authority.grant(&checked_id, generation))
                .await
                .map_err(|_| Error::Closed)??;
        let group = Arc::new(Group {
            session,
            generation,
            grant,
            events,
            cancel: watch::channel(false).0,
            sockets: Mutex::default(),
            listeners: Mutex::default(),
        });
        let mut groups = self.groups.lock().await;
        groups.retain(|_, existing| {
            !*existing.cancel.borrow()
                && !*existing.grant.revoked.borrow()
                && existing.grant.expires > super::super::sessions::now_ms()
        });
        if *group.grant.revoked.borrow()
            || groups.values().any(|existing| {
                existing.session == group.session && existing.generation >= group.generation
            })
        {
            return Err(Error::Closed);
        }
        groups.retain(|_, existing| {
            if existing.session != group.session {
                return true;
            }
            existing.cancel.send_replace(true);
            false
        });
        let id = uuid::Uuid::new_v4().to_string();
        groups.insert(id.clone(), group);
        Ok(id)
    }

    pub(super) async fn group(&self, id: &str) -> Result<Arc<Group>> {
        self.groups
            .lock()
            .await
            .get(id)
            .filter(|group| {
                !*group.cancel.borrow()
                    && !*group.grant.revoked.borrow()
                    && group.grant.expires > super::super::sessions::now_ms()
            })
            .cloned()
            .ok_or(Error::Closed)
    }

    pub(super) async fn connect(&self, id: &str, address: Address, ipv6: bool) -> Result<String> {
        let group = self.group(id).await?;
        let authority = self.authority.clone();
        let session = group.session.clone();
        let generation = group.generation;
        let checked = address.clone();
        tauri::async_runtime::spawn_blocking(move || {
            authority.allows(&session, generation, &checked)
        })
        .await
        .map_err(|_| Error::Closed)??;
        network::connect(group, address, ipv6).await
    }

    pub async fn stop(&self, id: &str) {
        if let Some(group) = self.groups.lock().await.remove(id) {
            group.cancel.send_replace(true);
        }
    }
}

impl Group {
    pub async fn write(&self, socket: &str, data: Vec<u8>) -> Result<()> {
        let (sender, receiver) = oneshot::channel();
        self.send(socket, SocketCommand::Write(data, sender))
            .await?;
        receiver.await.map_err(|_| Error::Closed)
    }
    pub async fn send(&self, socket: &str, command: SocketCommand) -> Result<()> {
        self.sockets
            .lock()
            .await
            .get(socket)
            .ok_or(Error::Closed)?
            .try_send(command)
            .map_err(|_| Error::Closed)
    }

    pub fn emit(&self, event: Event) -> Result<()> {
        self.events.send(event).map_err(|_| Error::Closed)
    }

    pub async fn stopped(&self) {
        let mut cancel = self.cancel.subscribe();
        let mut revoked = self.grant.revoked.subscribe();
        if *cancel.borrow() || *revoked.borrow() {
            return;
        }
        let expires = self
            .grant
            .expires
            .saturating_sub(super::super::sessions::now_ms());
        tokio::select! {
            _ = cancel.changed() => {},
            _ = revoked.changed() => {},
            _ = tokio::time::sleep(std::time::Duration::from_millis(expires)) => {},
        }
    }
}
