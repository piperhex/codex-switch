use portable_pty::PtySize;
use serde::{Deserialize, Serialize};

pub(super) const MAX_SESSIONS: usize = 8;
pub(super) const MAX_INPUT_BYTES: usize = 64 * 1024;

#[derive(Debug, thiserror::Error)]
pub(super) enum TerminalError {
    #[error("请在桌面端打开终端。")]
    Access,
    #[error("终端设置无效，请重试。")]
    Invalid,
    #[error("找不到这个文件夹，请重新选择项目。")]
    Directory,
    #[error("最多可同时打开 8 个终端，请先关闭一个。")]
    Limit,
    #[error("终端未能启动，请稍后重试。")]
    Start,
    #[error("终端已关闭，请新建一个终端。")]
    Closed,
    #[error("终端暂时无法响应，请关闭后重试。")]
    Io,
}

pub(super) type Result<T> = std::result::Result<T, TerminalError>;

#[derive(Clone, Copy, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct TerminalSize {
    pub cols: u16,
    pub rows: u16,
}

impl TerminalSize {
    pub(super) fn validate(self) -> Result<PtySize> {
        const MAX_DIMENSION: u16 = 500;
        if !(2..=MAX_DIMENSION).contains(&self.cols) || !(1..=MAX_DIMENSION).contains(&self.rows) {
            return Err(TerminalError::Invalid);
        }
        Ok(PtySize {
            cols: self.cols,
            rows: self.rows,
            pixel_width: 0,
            pixel_height: 0,
        })
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct OpenTerminal {
    pub cwd: Option<String>,
    pub size: TerminalSize,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
pub(crate) enum TerminalRequest {
    Write { id: String, data: String },
    Resize { id: String, size: TerminalSize },
    Close { id: String },
}

#[derive(Serialize)]
pub(crate) struct TerminalInfo {
    pub id: String,
    pub cwd: String,
    pub shell: String,
}

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub(crate) enum TerminalEvent {
    Output { data: Vec<u8> },
    Exit { code: Option<u32> },
    Error { message: String },
}
