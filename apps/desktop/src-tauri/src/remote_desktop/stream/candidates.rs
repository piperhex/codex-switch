use super::super::{DesktopError, Result};
use webrtc::{
    ice_transport::ice_candidate::RTCIceCandidateInit, peer_connection::RTCPeerConnection,
};

const MAX_CANDIDATE_BYTES: usize = 4096;

/// Invalid IPC shapes remain errors; a valid candidate rejected by WebRTC is counted and skipped.
pub(super) async fn apply(
    connection: &RTCPeerConnection,
    values: Vec<serde_json::Value>,
) -> Result<usize> {
    let candidates = values.into_iter().map(parse).collect::<Result<Vec<_>>>()?;
    let mut rejected = 0;
    for candidate in candidates {
        if connection.add_ice_candidate(candidate).await.is_err() {
            rejected += 1;
        }
    }
    Ok(rejected)
}

fn parse(value: serde_json::Value) -> Result<RTCIceCandidateInit> {
    let candidate: RTCIceCandidateInit =
        serde_json::from_value(value).map_err(|_| DesktopError::Invalid)?;
    if candidate.candidate.len() > MAX_CANDIDATE_BYTES {
        return Err(DesktopError::Invalid);
    }
    Ok(candidate)
}

#[cfg(test)]
mod tests {
    use super::*;
    use webrtc::api::APIBuilder;

    #[tokio::test]
    async fn a_rejected_candidate_does_not_discard_later_addresses() {
        let api = APIBuilder::new().build();
        let sender = api.new_peer_connection(Default::default()).await.unwrap();
        let receiver = api.new_peer_connection(Default::default()).await.unwrap();
        sender
            .create_data_channel("candidate-test", None)
            .await
            .unwrap();
        let offer = sender.create_offer(None).await.unwrap();
        receiver.set_remote_description(offer).await.unwrap();
        let rejected = apply(&receiver, vec![
            serde_json::json!({"candidate":"unsupported-candidate", "sdpMid":"0", "sdpMLineIndex":0}),
            serde_json::json!({"candidate":"candidate:1 1 udp 1 192.0.2.1 40000 typ host",
                "sdpMid":"0", "sdpMLineIndex":0}),
        ]).await.unwrap();
        assert_eq!(rejected, 1, "the valid candidate must still reach WebRTC");
        receiver.close().await.unwrap();
        sender.close().await.unwrap();
    }

    #[tokio::test]
    async fn malformed_and_oversized_inputs_remain_rejected() {
        let peer = APIBuilder::new()
            .build()
            .new_peer_connection(Default::default())
            .await
            .unwrap();
        for input in [
            serde_json::json!({"candidate": 123}),
            serde_json::json!({"candidate":"x".repeat(MAX_CANDIDATE_BYTES + 1)}),
        ] {
            assert!(apply(&peer, vec![input]).await.is_err());
        }
        peer.close().await.unwrap();
    }
}
