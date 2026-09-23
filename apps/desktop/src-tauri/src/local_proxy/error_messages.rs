//! Translate known connection failures without exposing upstream URLs or credentials.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum TransportFailure {
    TlsClosed,
    Certificate,
    Tls,
    Dns,
    Refused,
    Disconnected,
    ConnectTimeout,
    UploadTimeout,
    ResponseTimeout,
    Connection,
}

impl TransportFailure {
    fn message(self) -> &'static str {
        match self {
            Self::TlsClosed => concat!(
                "连接上游服务时，安全连接尚未建立就被断开。",
                "请检查网络或代理是否稳定后重试。",
            ),
            Self::Certificate => "无法验证上游服务的安全证书。请检查系统时间和代理设置后重试。",
            Self::Tls => "无法与上游服务建立安全连接。请检查网络或代理设置后重试。",
            Self::Dns => "无法解析上游服务的地址。请检查网络、代理或服务地址是否正确后重试。",
            Self::Refused => "连接被上游服务或代理拒绝。请确认服务可用，并检查代理地址和端口。",
            Self::Disconnected => "与上游服务的连接意外中断，请检查网络或代理是否稳定后重试。",
            Self::ConnectTimeout => "连接上游服务超时，请检查网络或代理是否可用后重试。",
            Self::UploadTimeout => "发送请求时超时，请检查网络或代理是否稳定后重试。",
            Self::ResponseTimeout => {
                "等待上游服务响应超时，请稍后重试。若持续出现，请检查服务状态。"
            }
            Self::Connection => "无法连接上游服务，请检查网络、代理和服务地址后重试。",
        }
    }

    // Order matters: certificate and handshake failures also contain generic connection errors.
    const RULES: &'static [(Self, &'static [&'static str])] = &[
        (Self::UploadTimeout, &["timed out during request upload"]),
        (
            Self::ResponseTimeout,
            &["timed out during response headers"],
        ),
        (
            Self::TlsClosed,
            &["tls handshake eof", "tls handshake: unexpected eof"],
        ),
        (
            Self::Certificate,
            &["certificate", "certnotvalid", "unknownissuer"],
        ),
        (Self::Tls, &["tls handshake", "tls error", "ssl error"]),
        (
            Self::Dns,
            &[
                "dns error",
                "failed to lookup address",
                "name or service not known",
                "os error 11001",
            ],
        ),
        (
            Self::Refused,
            &["connection refused", "actively refused", "os error 10061"],
        ),
        (
            Self::Disconnected,
            &[
                "connection reset",
                "connection closed",
                "broken pipe",
                "os error 10054",
            ],
        ),
        (Self::ConnectTimeout, &["timed out", "timeout"]),
    ];

    fn classify(detail: &str) -> Self {
        Self::RULES
            .iter()
            .find(|(_, markers)| markers.iter().any(|marker| detail.contains(marker)))
            .map_or(Self::Connection, |(failure, _)| *failure)
    }
}

pub(super) fn transport(error: &str) -> Option<&'static str> {
    let detail = error
        .strip_prefix("Official Codex proxy request failed: ")
        .or_else(|| error.strip_prefix("Provider proxy request failed: "))?;
    Some(TransportFailure::classify(&detail.to_ascii_lowercase()).message())
}

pub(super) fn gui(error: &str) -> &str {
    if let Some(message) = transport(error) {
        return message;
    }
    // Only fixed, user-safe account messages may bypass the fallback. Internal errors can
    // contain filesystem paths or credentials and belong in the sanitized diagnostics.
    match error {
        "请先选择 Codex GUI 账户。"
        | "暂时无法读取 Codex GUI 账户，请稍后重试。"
        | "此账户已不可用，请重新选择。"
        | "暂时无法读取自动切号设置，请稍后重试。"
        | "暂无符合条件的账号，请调整自动切号设置或选择其他账户。" => {
            error
        }
        "账户设置已更新。" => "账户设置已更新，请重试本次请求。",
        _ => "Codex GUI 请求未完成，暂时无法确认原因。请稍后重试，或导出诊断日志排查。",
    }
}

#[cfg(test)]
#[path = "error_messages_tests.rs"]
mod tests;
