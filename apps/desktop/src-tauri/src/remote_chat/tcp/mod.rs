//! Bounded TCP hole-punch sockets, restricted to destinations authorized by native chat signaling.
mod authority;
mod client;
#[cfg(test)]
mod client_tests;
mod commands;
mod network;
mod service;
#[cfg(test)]
mod tests;

pub(crate) use authority::Authority;
pub(super) use client::ClientSession;
pub(crate) use commands::*;
use std::{collections::HashMap, sync::Arc};
use tokio::sync::Mutex;

#[derive(Debug, thiserror::Error)]
pub(crate) enum Error {
    #[error("invalid TCP path request")]
    Invalid,
    #[error("TCP path is not authorized")]
    Denied,
    #[error("TCP path is closed")]
    Closed,
    #[error("TCP network unavailable")]
    Network(#[from] std::io::Error),
}
type Result<T> = std::result::Result<T, Error>;

#[derive(Default)]
pub(crate) struct State {
    pub authority: Arc<Authority>,
    pub client_authority: Arc<Authority>,
    groups: Mutex<HashMap<String, Arc<service::Group>>>,
}
