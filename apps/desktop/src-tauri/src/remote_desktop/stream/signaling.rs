use super::super::{DesktopError, Result};
use super::{model::*, peer::Peer};
use webrtc::peer_connection::sdp::session_description::RTCSessionDescription;

impl Peer {
    pub async fn offer(&self) -> Result<Offer> {
        let offer = self
            .connection
            .create_offer(None)
            .await
            .map_err(|_| DesktopError::Platform)?;
        let sdp = offer.sdp.clone();
        self.connection
            .set_local_description(offer)
            .await
            .map_err(|_| DesktopError::Platform)?;
        Ok(Offer {
            sdp,
            direct_upgrade: true,
            relay_standby: false,
        })
    }

    pub async fn signal(&self, request: SignalRequest) -> Result<SignalReply> {
        let _serial = self.signaling.lock().await;
        let received = self.ice.lock().await.remote_candidates;
        if request.candidates.len() + received > super::MAX_CANDIDATES {
            return Err(DesktopError::Invalid);
        }
        if let Some(answer) = request.answer {
            if answer.len() > 64_000 || self.connection.remote_description().await.is_some() {
                return Err(DesktopError::Invalid);
            }
            let description =
                RTCSessionDescription::answer(answer).map_err(|_| DesktopError::Invalid)?;
            self.connection
                .set_remote_description(description)
                .await
                .map_err(|_| DesktopError::Platform)?;
        }
        self.ice.lock().await.remote_candidates += request.candidates.len();
        let rejected = super::candidates::apply(&self.connection, request.candidates).await?;
        self.ice.lock().await.rejected_candidates += rejected;
        Ok(SignalReply {
            candidates: self.candidates.lock().await.drain(..).collect(),
            ..Default::default()
        })
    }

    pub async fn direct(&self) -> bool {
        use webrtc::ice_transport::ice_candidate_type::RTCIceCandidateType;
        self.connection
            .sctp()
            .transport()
            .ice_transport()
            .get_selected_candidate_pair()
            .await
            .is_some_and(|pair| {
                ![pair.local.typ, pair.remote.typ].contains(&RTCIceCandidateType::Relay)
                    || self.native_media.as_ref().is_some_and(|(local, remote)| {
                        pair.local.typ == RTCIceCandidateType::Relay
                            && &pair.local.address == local
                            && &pair.remote.address == remote
                    })
            })
    }

    pub async fn close(&self) {
        if let Err(error) = self.connection.close().await {
            eprintln!("desktop media cleanup: {error}");
        }
        self.transports.close();
    }
}
