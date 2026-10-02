//! Bounded fallback for a random-mapping NAT opposite an incremental/decremental NAT.
//! The hard side opens a small socket/port matrix before asking the easy side to probe.
//! Existing authenticated RPCs and the normal encrypted transport admission are retained.

use std::{
    net::{Ipv4Addr, SocketAddr},
    sync::Arc,
    time::Duration,
};

use tokio_util::task::AbortOnDropHandle;

use super::{
    SelectPunchListener, SendPunchPacketHardSym, UdpHolePunchRuntime, UdpHolePunchSignaling,
    UdpPunchSocket, UdpPunchTaskInfo, UdpSocketArray, client::UdpHolePunchClientResult,
    mixed_budget::MixedBudget,
};
use crate::{
    connectivity::stun::StunInfoProvider,
    packet::{HOLE_PUNCH_PACKET_BODY_LEN, new_hole_punch_packet},
};

// At most 4096 distinct NAT mappings and 12,288 small packets per round. The remote
// legacy RPC is capped to 200 destinations per pass by round=8 (two passes).
const MAX_PUBLIC_IPS: usize = 2;
const REMOTE_BUDGET_ROUND: u32 = 8;
const ATTEMPT_TIMEOUT: Duration = Duration::from_secs(10);
const PROBE_PACE: Duration = Duration::from_millis(2);
const RESPONSE_POLL: Duration = Duration::from_millis(20);
const RESPONSE_GRACE: Duration = Duration::from_millis(500);

pub(super) struct MixedPunch<R, S> {
    pub runtime: Arc<R>,
    pub signaling: Arc<S>,
    pub stun: Arc<dyn StunInfoProvider>,
    pub target: UdpPunchTaskInfo,
    pub budget: MixedBudget,
}

struct ProbePlan {
    remote: SocketAddr,
    ports: Vec<u16>,
    transaction_id: u32,
}

impl<R: UdpHolePunchRuntime, S: UdpHolePunchSignaling + 'static> MixedPunch<R, S> {
    pub async fn run(&self) -> UdpHolePunchClientResult<Option<UdpPunchSocket>> {
        match crate::foundation::time::timeout(ATTEMPT_TIMEOUT, self.attempt()).await {
            Ok(result) => result,
            Err(_) => Ok(None),
        }
    }

    async fn attempt(&self) -> UdpHolePunchClientResult<Option<UdpPunchSocket>> {
        let public_ips = usable_public_ips(&self.stun.get_stun_info().public_ip);
        if public_ips.is_empty() {
            return Ok(None);
        }
        let Some(plan) = self.plan().await? else {
            return Ok(None);
        };
        let sockets = UdpSocketArray::new_with_context(
            self.budget.sockets(),
            self.runtime.clone(),
            self.runtime.socket_context(),
        );
        sockets.start().await?;
        sockets.add_interest_tid(plan.transaction_id);
        tracing::info!(
            sockets = self.budget.sockets(),
            predicted_ports = plan.ports.len(),
            "mixed symmetric UDP attempt starting"
        );
        self.prepare_mappings(&sockets, &plan).await?;
        let request = SendPunchPacketHardSym {
            listener_mapped_addr: plan.remote,
            public_ips,
            transaction_id: plan.transaction_id,
            port_index: rand::random(),
            round: REMOTE_BUDGET_ROUND,
        };
        self.probe_remote(&sockets, request, &plan).await
    }

    async fn plan(&self) -> UdpHolePunchClientResult<Option<ProbePlan>> {
        let Some(incremental) = self.target.dst_nat_type.get_inc_of_easy_sym() else {
            return Ok(None);
        };
        let remote = self
            .signaling
            .select_punch_listener(
                self.target.dst_peer_id,
                SelectPunchListener {
                    force_new: true,
                    prefer_port_mapping: false,
                },
            )
            .await?
            .listener_mapped_addr;
        let ports = predicted_ports(remote.port(), incremental, self.budget.port_span());
        if usable_public_ips(&[remote.ip().to_string()]).is_empty() || ports.is_empty() {
            return Ok(None);
        }
        Ok(Some(ProbePlan {
            remote,
            ports,
            transaction_id: rand::random(),
        }))
    }

    async fn prepare_mappings(
        &self,
        sockets: &UdpSocketArray<R>,
        plan: &ProbePlan,
    ) -> anyhow::Result<()> {
        let packet =
            new_hole_punch_packet(plan.transaction_id, HOLE_PUNCH_PACKET_BODY_LEN).into_bytes();
        let mut remote = plan.remote;
        for port in &plan.ports {
            remote.set_port(*port);
            sockets.send_with_all(&packet, remote).await?;
            crate::foundation::time::sleep(PROBE_PACE).await;
        }
        Ok(())
    }

    async fn probe_remote(
        &self,
        sockets: &UdpSocketArray<R>,
        request: SendPunchPacketHardSym,
        plan: &ProbePlan,
    ) -> UdpHolePunchClientResult<Option<UdpPunchSocket>> {
        let signaling = self.signaling.clone();
        let peer = self.target.dst_peer_id;
        // Dropping either the attempt or the connection cancels this child operation.
        let mut task = AbortOnDropHandle::new(tokio::spawn(async move {
            signaling.send_punch_packet_hard_sym(peer, request).await
        }));
        loop {
            if let Some(socket) = self.receive(sockets, plan).await? {
                return Ok(Some(socket));
            }
            tokio::select! {
                result = &mut task => {
                    result.map_err(anyhow::Error::from)??;
                    crate::foundation::time::sleep(RESPONSE_GRACE).await;
                    return self.receive(sockets, plan).await;
                }
                _ = crate::foundation::time::sleep(RESPONSE_POLL) => {}
            }
        }
    }

    async fn receive(
        &self,
        sockets: &UdpSocketArray<R>,
        plan: &ProbePlan,
    ) -> UdpHolePunchClientResult<Option<UdpPunchSocket>> {
        while let Some(punched) = sockets.try_fetch_punched_socket(plan.transaction_id) {
            if punched.remote_addr.ip() != plan.remote.ip()
                || !plan.ports.contains(&punched.remote_addr.port())
            {
                sockets.add_new_socket(punched.socket).await?;
                continue;
            }
            // The peer's actual source port, not its STUN mapping, is the usable tuple.
            match self
                .runtime
                .connect_with_socket(punched.socket.clone(), punched.remote_addr)
                .await
            {
                Ok(socket) => return Ok(Some(socket)),
                Err(_) => sockets.add_new_socket(punched.socket).await?,
            }
        }
        Ok(None)
    }
}

fn predicted_ports(base: u16, incremental: bool, span: u16) -> Vec<u16> {
    (1..=span)
        .filter_map(|offset| {
            if incremental {
                base.checked_add(offset)
            } else {
                base.checked_sub(offset)
            }
        })
        .filter(|port| *port != 0)
        .collect()
}

fn usable_public_ips(values: &[String]) -> Vec<Ipv4Addr> {
    let mut ips = Vec::new();
    for value in values {
        let Ok(ip) = value.parse::<Ipv4Addr>() else {
            continue;
        };
        if ip.is_unspecified()
            || ip.is_multicast()
            || ip.is_loopback()
            || ip.is_private()
            || ip.is_link_local()
            || ip.is_broadcast()
            || ips.contains(&ip)
        {
            continue;
        }
        ips.push(ip);
        if ips.len() == MAX_PUBLIC_IPS {
            break;
        }
    }
    ips
}

#[cfg(test)]
#[path = "mixed_tests.rs"]
mod tests;
