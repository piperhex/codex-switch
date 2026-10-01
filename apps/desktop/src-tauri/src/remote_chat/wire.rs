use super::protocol::{ChatError, Outgoing};
use serde_json::json;
use tungstenite::Message;

const MAGIC: &[u8] = b"CSB1";
const HEADER_BYTES: usize = 5;
const MAX_SESSION_BYTES: usize = 128;
const MAX_PAYLOAD_BYTES: usize = 20_000;
const HEX: &[u8] = b"0123456789abcdef";

fn valid_session(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= MAX_SESSION_BYTES
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"_-".contains(&byte))
}

/// Negotiate independently on each coordinator connection; older servers keep text frames.
pub(super) fn encode(frame: &Outgoing, binary: bool) -> Result<Message, ChatError> {
    frame.validate()?;
    if binary {
        if let Outgoing::Relay {
            session_id,
            payload,
        } = frame
        {
            return encode_relay(session_id, payload);
        }
    }
    serde_json::to_string(frame)
        .map(|text| Message::Text(text.into()))
        .map_err(|_| ChatError::InvalidFrame)
}

fn encode_relay(id: &str, payload: &str) -> Result<Message, ChatError> {
    if !valid_session(id) || payload.is_empty() || !payload.len().is_multiple_of(2) {
        return Err(ChatError::InvalidFrame);
    }
    let mut bytes = Vec::with_capacity(HEADER_BYTES + id.len() + payload.len() / 2);
    bytes.extend_from_slice(MAGIC);
    bytes.push(id.len() as u8);
    bytes.extend_from_slice(id.as_bytes());
    for pair in payload.as_bytes().as_chunks::<2>().0 {
        let text = std::str::from_utf8(pair).map_err(|_| ChatError::InvalidFrame)?;
        bytes.push(u8::from_str_radix(text, 16).map_err(|_| ChatError::InvalidFrame)?);
    }
    Ok(Message::Binary(bytes.into()))
}

/// IPC remains typed JSON; ciphertext is binary only on the network hop.
pub(super) fn decode(bytes: &[u8]) -> Result<String, ChatError> {
    if bytes.len() <= HEADER_BYTES || !bytes.starts_with(MAGIC) {
        return Err(ChatError::InvalidFrame);
    }
    let end = HEADER_BYTES + usize::from(bytes[MAGIC.len()]);
    if end >= bytes.len() || bytes.len() - end > MAX_PAYLOAD_BYTES {
        return Err(ChatError::InvalidFrame);
    }
    let id = std::str::from_utf8(&bytes[HEADER_BYTES..end]).map_err(|_| ChatError::InvalidFrame)?;
    if !valid_session(id) {
        return Err(ChatError::InvalidFrame);
    }
    let mut payload = String::with_capacity((bytes.len() - end) * 2);
    for byte in &bytes[end..] {
        payload.push(HEX[usize::from(byte >> 4)] as char);
        payload.push(HEX[usize::from(byte & 15)] as char);
    }
    Ok(json!({"type": "relay", "sessionId": id, "payload": payload}).to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn binary_round_trip_and_legacy_fallback() {
        let frame = Outgoing::Relay {
            session_id: "session-1".into(),
            payload: "00abff".into(),
        };
        let Message::Binary(bytes) = encode(&frame, true).unwrap() else {
            panic!("expected binary")
        };
        assert_eq!(&bytes[..], b"CSB1\x09session-1\x00\xab\xff");
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&decode(&bytes).unwrap()).unwrap(),
            serde_json::to_value(&frame).unwrap()
        );
        assert!(matches!(encode(&frame, false).unwrap(), Message::Text(_)));
    }

    #[test]
    fn malformed_binary_is_rejected_without_panicking() {
        for bytes in [&b""[..], b"CSB1\xffx", b"CSB1\x00x", b"CSB1\x01/hello"] {
            assert!(decode(bytes).is_err());
        }
    }

    #[test]
    fn diagnostic_ipc_frames_reach_the_coordinator_as_json_in_both_relay_modes() {
        let value = json!({"type": "diagnostic", "sessionId": "phone",
            "payload": {"event": "peer-created", "scope": "chat", "generation": 0}});
        let frame: Outgoing = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(frame.session_id(), "phone");
        for binary in [false, true] {
            let Message::Text(text) = encode(&frame, binary).unwrap() else {
                panic!("diagnostics must remain JSON")
            };
            assert_eq!(
                serde_json::from_str::<serde_json::Value>(&text).unwrap(),
                value
            );
        }
    }

    #[test]
    fn diagnostic_ipc_validation_rejects_invalid_sessions_and_payloads() {
        for (session, payload) in [
            ("".to_string(), json!({"event": "peer-created"})),
            ("x".repeat(161), json!({"event": "peer-created"})),
            ("phone".into(), json!(null)),
            ("phone".into(), json!([])),
            ("phone".into(), json!({})),
            ("phone".into(), json!({"event": 1})),
            ("phone".into(), json!({"event": ""})),
            ("phone".into(), json!({"event": "x".repeat(65)})),
        ] {
            let frame: Outgoing = serde_json::from_value(json!({
                "type": "diagnostic", "sessionId": session, "payload": payload
            }))
            .unwrap();
            assert!(encode(&frame, true).is_err());
        }
    }

    #[test]
    fn diagnostic_limit_counts_the_complete_utf8_frame_in_both_relay_modes() {
        let mut value = json!({"type": "diagnostic", "sessionId": "phone",
            "payload": {"event": "peer-created", "extension": "诊断"}});
        let remaining = super::super::protocol::DIAGNOSTIC_FRAME_LIMIT
            - serde_json::to_vec(&value).unwrap().len();
        value["payload"]["extension"] = json!(format!("诊断{}", "x".repeat(remaining)));
        let frame: Outgoing = serde_json::from_value(value.clone()).unwrap();
        let extension = value["payload"]["extension"].as_str().unwrap().to_owned() + "x";
        value["payload"]["extension"] = json!(extension);
        let oversized: Outgoing = serde_json::from_value(value).unwrap();
        for binary in [false, true] {
            assert!(encode(&frame, binary).is_ok());
            assert!(encode(&oversized, binary).is_err());
        }
    }
}
