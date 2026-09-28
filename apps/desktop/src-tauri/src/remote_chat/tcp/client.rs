use super::{
    authority::{parse_grant, update_peers},
    Authority, Error, Result,
};
use serde_json::Value;
use std::sync::Arc;

/// A signaling worker owns only its PC-client grants, independently of the local host's peers.
pub(crate) struct ClientSession {
    authority: Arc<Authority>,
    owner: String,
    session: Option<String>,
}

impl ClientSession {
    pub fn new(authority: Arc<Authority>, owner: String) -> Self {
        Self {
            authority,
            owner,
            session: None,
        }
    }

    /// Validate and install native permissions before delivering a frame to the WebView.
    pub fn receive(&mut self, message: &Value) -> Result<()> {
        let Some(id) = message["sessionId"].as_str() else {
            return Ok(());
        };
        if matches!(message["type"].as_str(), Some("paired" | "resumed")) {
            if self.session.as_deref().is_some_and(|session| session != id) {
                return Err(Error::Denied);
            }
            self.paired(message, id)?;
            self.session = Some(id.to_owned());
            return Ok(());
        }
        if self.session.as_deref() != Some(id) {
            return Err(Error::Denied);
        }
        let mut grants = self.authority.0.write().map_err(|_| Error::Closed)?;
        let Some(grant) = grants
            .get_mut(id)
            .filter(|grant| grant.owner.as_deref() == Some(&self.owner))
        else {
            return Ok(());
        };
        if message["type"] == "peer-close" {
            grant.revoked.send_replace(true);
            grants.remove(id);
        } else if message["type"] == "signal" && message["payload"]["kind"] == "tcp" {
            update_peers(grant, &message["payload"])?;
        }
        Ok(())
    }

    fn paired(&self, message: &Value, id: &str) -> Result<()> {
        let mut grants = self.authority.0.write().map_err(|_| Error::Closed)?;
        if self.session.is_some()
            && grants
                .get(id)
                .is_some_and(|grant| grant.owner.as_deref() != Some(&self.owner))
        {
            return Err(Error::Denied);
        }
        if message["type"] == "resumed" {
            if let Some(grant) = grants.get_mut(id) {
                grant.expires = message["expiresAt"].as_u64().ok_or(Error::Invalid)?;
                grant.owner = Some(self.owner.clone());
                return Ok(());
            }
        }
        if !message["tcpPunch"].is_object() {
            return Ok(());
        }
        let mut grant = parse_grant(message)?;
        grant.owner = Some(self.owner.clone());
        if let Some(previous) = grants.insert(id.to_owned(), grant) {
            previous.revoked.send_replace(true);
        }
        Ok(())
    }
}

impl Drop for ClientSession {
    fn drop(&mut self) {
        match self.authority.0.write() {
            Ok(mut grants) => grants.retain(|_, grant| {
                if grant.owner.as_deref() != Some(&self.owner) {
                    return true;
                }
                grant.revoked.send_replace(true);
                false
            }),
            Err(error) => eprintln!("TCP client cleanup: {error}"),
        }
    }
}
