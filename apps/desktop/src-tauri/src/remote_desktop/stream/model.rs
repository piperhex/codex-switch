#[cfg(windows)]
use super::super::{DesktopError, Result};
use serde::{Deserialize, Serialize};

/// Validated capture/encoder limits; no caller-supplied paths or process arguments cross IPC.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Profile {
    #[serde(default)]
    pub adaptive_fps: bool,
    pub width: u32,
    pub fps: u32,
    pub bitrate: u32,
}

#[cfg(windows)]
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

#[cfg(windows)]
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

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpenRequest {
    #[serde(default)]
    pub clipboard_channel: bool,
    pub id: String,
    pub profile: Profile,
    pub ice_servers: Vec<IceServer>,
}

#[derive(Deserialize, Serialize)]
pub(crate) struct SignalRequest {
    pub id: String,
    pub answer: Option<String>,
    pub candidates: Vec<serde_json::Value>,
}

#[derive(Deserialize, Serialize)]
pub(crate) struct Offer {
    pub sdp: String,
}

#[derive(Deserialize, Serialize)]
pub(crate) struct SignalReply {
    pub candidates: Vec<serde_json::Value>,
}

#[derive(Clone, Default, Deserialize, Serialize)]
pub(crate) struct StreamStats {
    pub fps: f64,
    pub width: u32,
    pub height: u32,
    pub bitrate: u32,
    pub closed: bool,
    pub connection: Option<Connection>,
    pub audio: Option<AudioState>,
    #[serde(default)]
    pub ice: IceDiagnostics,
}

/// Only bounded counters and fixed state names cross IPC; candidate addresses and SDP stay in WebRTC.
#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct IceDiagnostics {
    pub state: String,
    pub local_candidates: usize,
    pub remote_candidates: usize,
    pub rejected_candidates: usize,
}

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum AudioState {
    Starting,
    Playing,
    Unavailable,
}

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Connection {
    Direct,
    Relay,
}
