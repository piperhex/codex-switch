use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::HashMap, net::IpAddr, sync::RwLock};
use tokio::sync::watch;

use super::{Error, Result};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub(crate) struct Address {
    pub host: String,
    pub port: u16,
}

impl Address {
    pub fn valid_peer(&self) -> bool {
        self.port >= 1024
            && self.host.parse::<IpAddr>().is_ok_and(|ip| match ip {
                IpAddr::V4(ip) => {
                    !ip.is_loopback()
                        && !ip.is_link_local()
                        && !ip.is_multicast()
                        && !ip.is_unspecified()
                        && ip.octets()[0] < 224
                        && ip.octets()[0] != 0
                }
                IpAddr::V6(ip) => {
                    matches!(ip.segments()[0] & 0xe000, 0x2000)
                        || ip.segments()[0] & 0xfe00 == 0xfc00
                }
            })
    }
}

#[derive(Clone)]
pub(super) struct Grant {
    pub owner: Option<String>,
    pub servers: Vec<Address>,
    pub peers: Vec<Address>,
    pub generation: u64,
    pub expires: u64,
    pub revoked: watch::Sender<bool>,
}

#[derive(Default)]
pub(crate) struct Authority(pub(super) RwLock<HashMap<String, Grant>>);

impl Authority {
    #[cfg(test)]
    pub(crate) fn has_client_session(&self, id: &str) -> bool {
        self.0
            .read()
            .unwrap()
            .get(id)
            .is_some_and(|grant| grant.owner.is_some())
    }

    /// Only the authenticated native signaling worker may grant network destinations.
    pub fn receive(&self, message: &Value) -> Result<()> {
        let Some(id) = message["sessionId"].as_str() else {
            return Ok(());
        };
        if message["type"] == "peer-close" {
            return self.remove(id);
        }
        let mut grants = self.0.write().map_err(|_| Error::Closed)?;
        if message["type"] == "peer-open" && message["tcpPunch"].is_object() {
            if let Some(previous) = grants.insert(id.into(), parse_grant(message)?) {
                previous.revoked.send_replace(true);
            }
        } else if let Some(grant) = grants.get_mut(id) {
            if message["type"] == "resumed" {
                grant.expires = message["expiresAt"].as_u64().ok_or(Error::Invalid)?;
            } else if message["type"] == "signal" && message["payload"]["kind"] == "tcp" {
                update_peers(grant, &message["payload"])?;
            }
        }
        Ok(())
    }

    pub fn remove(&self, id: &str) -> Result<()> {
        if let Some(grant) = self.0.write().map_err(|_| Error::Closed)?.remove(id) {
            grant.revoked.send_replace(true);
        }
        Ok(())
    }

    pub fn clear(&self) -> Result<()> {
        for (_, grant) in self.0.write().map_err(|_| Error::Closed)?.drain() {
            grant.revoked.send_replace(true);
        }
        Ok(())
    }

    pub(super) fn grant(&self, id: &str, generation: u64) -> Result<Grant> {
        let grants = self.0.read().map_err(|_| Error::Closed)?;
        let grant = grants
            .get(id)
            .filter(|grant| {
                grant.expires > super::super::sessions::now_ms()
                    && generation >= grant.generation
                    && (grant.owner.is_some() || generation <= grant.generation.saturating_add(1))
            })
            .ok_or(Error::Denied)?;
        Ok(grant.clone())
    }

    pub(super) fn allows(&self, id: &str, generation: u64, address: &Address) -> Result<()> {
        let grant = self.grant(id, generation)?;
        if grant.servers.contains(address)
            || (grant.generation == generation && grant.peers.contains(address))
        {
            Ok(())
        } else {
            Err(Error::Denied)
        }
    }
}

pub(super) fn parse_grant(message: &Value) -> Result<Grant> {
    let servers: Vec<Address> = serde_json::from_value(message["tcpPunch"]["servers"].clone())
        .map_err(|_| Error::Invalid)?;
    if servers.is_empty()
        || servers.len() > 2
        || servers.iter().any(|server| {
            server.port < 1024
                || server.host.is_empty()
                || server.host.len() > 253
                || server
                    .host
                    .chars()
                    .any(|c| !(c.is_ascii_alphanumeric() || "-.:".contains(c)))
        })
    {
        return Err(Error::Invalid);
    }
    Ok(Grant {
        owner: None,
        servers,
        peers: Vec::new(),
        generation: 0,
        expires: message["expiresAt"].as_u64().ok_or(Error::Invalid)?,
        revoked: watch::channel(false).0,
    })
}

pub(super) fn update_peers(grant: &mut Grant, signal: &Value) -> Result<()> {
    let generation = signal["generation"].as_u64().unwrap_or(0);
    if generation < grant.generation {
        return Ok(());
    }
    let peers: Vec<Address> =
        serde_json::from_value(signal["addresses"].clone()).map_err(|_| Error::Invalid)?;
    if peers.len() > 6 || peers.iter().any(|address| !address.valid_peer()) {
        return Err(Error::Invalid);
    }
    grant.generation = generation;
    grant.peers = peers;
    Ok(())
}
