use std::collections::HashMap;

use serde::Serialize;
use serde_json::Value;

use super::protocol::ChatError;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Resume {
    session_id: String,
    resume_token: String,
    #[serde(skip)]
    expires_at: u64,
    #[serde(skip)]
    key_sent: bool,
}

#[derive(Default)]
pub(super) struct Sessions {
    resumes: HashMap<String, Resume>,
    legacy: std::collections::HashSet<String>,
}

impl Sessions {
    pub fn contains(&self, id: &str) -> bool {
        self.resumes.contains_key(id) || self.legacy.contains(id)
    }
    pub fn remove(&mut self, id: &str) {
        self.resumes.remove(id);
        self.legacy.remove(id);
    }
    pub fn clear(&mut self) {
        self.resumes.clear();
        self.legacy.clear();
    }

    pub fn key_sent(&mut self, id: &str) {
        if let Some(resume) = self.resumes.get_mut(id) {
            resume.key_sent = true;
        }
    }

    pub fn disconnected(&mut self) -> Vec<String> {
        let mut closed: Vec<_> = self.legacy.drain().collect();
        self.resumes.retain(|id, resume| {
            if !resume.key_sent {
                closed.push(id.clone());
            }
            resume.key_sent
        });
        closed
    }

    pub fn authentication(&mut self) -> Vec<&Resume> {
        self.legacy.clear();
        let now = now_ms();
        self.resumes.retain(|_, resume| resume.expires_at > now);
        self.resumes.values().collect()
    }

    pub fn receive(&mut self, message: &Value) -> Result<(), ChatError> {
        match message["type"].as_str() {
            Some("peer-open") => self.open(message),
            Some("peer-close") => {
                self.remove(
                    message["sessionId"]
                        .as_str()
                        .ok_or(ChatError::InvalidFrame)?,
                );
                Ok(())
            }
            Some("resumed") => {
                if let Some(resume) = message["sessionId"]
                    .as_str()
                    .and_then(|id| self.resumes.get_mut(id))
                {
                    resume.expires_at = message["expiresAt"]
                        .as_u64()
                        .ok_or(ChatError::InvalidFrame)?;
                }
                Ok(())
            }
            _ => Ok(()),
        }
    }

    fn open(&mut self, message: &Value) -> Result<(), ChatError> {
        let id = message["sessionId"]
            .as_str()
            .filter(|id| !id.is_empty() && id.len() <= 160)
            .ok_or(ChatError::InvalidFrame)?;
        // Only the authenticated coordinator opens sessions and enforces its configured admission limit.
        if self.contains(id) {
            return Err(ChatError::InvalidFrame);
        }
        if message["transportVersion"] != 2 {
            self.legacy.insert(id.to_owned());
            return Ok(());
        }
        let token = message["resumeToken"]
            .as_str()
            .filter(|token| token.len() <= 256)
            .ok_or(ChatError::InvalidFrame)?;
        let expires_at = message["expiresAt"]
            .as_u64()
            .ok_or(ChatError::InvalidFrame)?;
        self.resumes.insert(
            id.to_owned(),
            Resume {
                session_id: id.to_owned(),
                resume_token: token.to_owned(),
                expires_at,
                key_sent: false,
            },
        );
        Ok(())
    }
}

pub(super) fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
