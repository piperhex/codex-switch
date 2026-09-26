use super::super::{DesktopError, Result};
use serde::{Deserialize, Serialize};

/// Validated capture/encoder limits; no caller-supplied paths or process arguments cross IPC.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
pub(crate) struct Profile {
    pub width: u32,
    pub fps: u32,
    pub bitrate: u32,
}

impl Profile {
    pub(super) fn validate(self) -> Result<Self> {
        super::super::validation::width(self.width)?;
        if !(1..=144).contains(&self.fps) || !(200_000..=32_000_000).contains(&self.bitrate) {
            return Err(DesktopError::Invalid);
        }
        Ok(self)
    }
}

#[derive(Clone, Deserialize, Serialize)]
pub(crate) struct IceServer {
    pub urls: Vec<String>,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub credential: String,
}

impl IceServer {
    pub(super) fn validate(&self) -> Result<()> {
        if self.urls.len() > 8 || self.username.len() > 512 || self.credential.len() > 512 {
            return Err(DesktopError::Invalid);
        }
        for value in &self.urls {
            if value.len() > 2048
                || !["stun:", "stuns:", "turn:", "turns:"]
                    .iter()
                    .any(|prefix| value.starts_with(prefix))
            {
                return Err(DesktopError::Invalid);
            }
        }
        Ok(())
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpenRequest {
    pub id: String,
    pub profile: Profile,
    pub ice_servers: Vec<IceServer>,
}

#[derive(Deserialize)]
pub(crate) struct SignalRequest {
    pub id: String,
    pub answer: Option<String>,
    pub candidates: Vec<serde_json::Value>,
}

#[derive(Serialize)]
pub(crate) struct Offer {
    pub sdp: String,
}

#[derive(Serialize)]
pub(crate) struct SignalReply {
    pub candidates: Vec<serde_json::Value>,
}

#[derive(Clone, Default, Serialize)]
pub(crate) struct StreamStats {
    pub fps: f64,
    pub width: u32,
    pub height: u32,
    pub bitrate: u32,
    pub closed: bool,
    pub connection: Option<Connection>,
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Connection {
    Direct,
    Relay,
}
