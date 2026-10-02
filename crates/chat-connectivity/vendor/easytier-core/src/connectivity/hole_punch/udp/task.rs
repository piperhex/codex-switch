use crate::{
    config::{P2pPolicyFlags, PeerId},
    proto::common::{NatType, PeerFeatureFlag},
};

use super::{
    super::policy::{should_background_p2p_with_peer, should_try_p2p_with_peer},
    UdpNatType,
    diagnostics::PunchReason,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UdpPunchCandidate {
    pub peer_id: PeerId,
    pub udp_nat_type: NatType,
    pub feature_flag: Option<PeerFeatureFlag>,
    pub has_direct_connection: bool,
    pub has_recent_traffic: bool,
}

#[derive(Clone, Copy, Debug, Hash, Eq, PartialEq)]
pub struct UdpPunchTaskInfo {
    pub dst_peer_id: PeerId,
    pub dst_nat_type: UdpNatType,
    pub my_nat_type: UdpNatType,
}

pub fn collect_udp_punch_tasks<I, F>(
    my_peer_id: PeerId,
    my_nat_type: UdpNatType,
    policy: P2pPolicyFlags,
    candidates: I,
    is_blacklisted: F,
) -> Vec<UdpPunchTaskInfo>
where
    I: IntoIterator<Item = UdpPunchCandidate>,
    F: Fn(PeerId) -> bool,
{
    candidates
        .into_iter()
        .filter_map(|candidate| {
            let task = UdpPunchTaskInfo {
                dst_peer_id: candidate.peer_id,
                dst_nat_type: candidate.udp_nat_type.into(),
                my_nat_type,
            };
            selection_reason(
                (my_peer_id, task),
                policy,
                &candidate,
                is_blacklisted(candidate.peer_id),
            )
            .is_none()
            .then_some(task)
        })
        .collect()
}

pub(super) fn selection_reason(
    local: (PeerId, UdpPunchTaskInfo),
    policy: P2pPolicyFlags,
    candidate: &UdpPunchCandidate,
    blacklisted: bool,
) -> Option<PunchReason> {
    let (my_peer_id, task) = local;
    if task.my_nat_type.is_open() {
        return Some(PunchReason::OpenNetwork);
    }
    let flag = candidate.feature_flag.as_ref();
    let background = should_background_p2p_with_peer(
        flag,
        false,
        policy.lazy_p2p,
        policy.disable_p2p,
        policy.need_p2p,
    );
    let demanded = should_try_p2p_with_peer(flag, false, policy.disable_p2p, policy.need_p2p)
        && candidate.has_recent_traffic;
    if !background && !demanded {
        return Some(PunchReason::Policy);
    }
    if blacklisted {
        return Some(PunchReason::Blacklisted);
    }
    if candidate.has_direct_connection {
        return Some(PunchReason::AlreadyDirect);
    }
    if task.my_nat_type.can_punch_hole_as_client(
        task.dst_nat_type,
        my_peer_id,
        task.dst_peer_id,
        policy.disable_sym_hole_punching,
    ) {
        return None;
    }
    Some(nat_skip_reason(task, policy))
}

fn nat_skip_reason(task: UdpPunchTaskInfo, policy: P2pPolicyFlags) -> PunchReason {
    if task.dst_nat_type.is_open() {
        return PunchReason::OpenNetwork;
    }
    if policy.disable_sym_hole_punching && task.my_nat_type.is_sym() && task.dst_nat_type.is_sym() {
        return PunchReason::SymmetricDisabled;
    }
    if (task.my_nat_type.is_hard_sym() && task.dst_nat_type.is_hard_sym())
        || (task.my_nat_type.is_sym()
            && task.dst_nat_type.is_sym()
            && [task.my_nat_type, task.dst_nat_type]
                .into_iter()
                .any(|nat| NatType::from(nat) == NatType::SymUdpFirewall))
    {
        return PunchReason::UnsupportedNat;
    }
    PunchReason::AwaitPeer
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::proto::common::PeerFeatureFlag;

    #[test]
    fn diagnostic_skip_reasons_distinguish_peer_initiation_from_unsupported_pairs() {
        for (local, remote, expected) in [
            (NatType::Symmetric, NatType::SymmetricEasyInc, None),
            (
                NatType::SymmetricEasyInc,
                NatType::Symmetric,
                Some(PunchReason::AwaitPeer),
            ),
            (
                NatType::Symmetric,
                NatType::Symmetric,
                Some(PunchReason::UnsupportedNat),
            ),
            (
                NatType::SymUdpFirewall,
                NatType::SymmetricEasyInc,
                Some(PunchReason::UnsupportedNat),
            ),
            (
                NatType::SymmetricEasyInc,
                NatType::SymUdpFirewall,
                Some(PunchReason::UnsupportedNat),
            ),
        ] {
            let peer = candidate(2, remote);
            let task = UdpPunchTaskInfo {
                dst_peer_id: 2,
                dst_nat_type: remote.into(),
                my_nat_type: local.into(),
            };
            assert_eq!(
                selection_reason((1, task), P2pPolicyFlags::default(), &peer, false),
                expected
            );
        }
    }

    fn candidate(peer_id: PeerId, udp_nat_type: NatType) -> UdpPunchCandidate {
        UdpPunchCandidate {
            peer_id,
            udp_nat_type,
            feature_flag: Some(PeerFeatureFlag::default()),
            has_direct_connection: false,
            has_recent_traffic: false,
        }
    }

    fn collect(
        my_peer_id: PeerId,
        my_nat_type: NatType,
        policy: P2pPolicyFlags,
        candidates: Vec<UdpPunchCandidate>,
    ) -> Vec<UdpPunchTaskInfo> {
        collect_udp_punch_tasks(my_peer_id, my_nat_type.into(), policy, candidates, |_| {
            false
        })
    }

    #[test]
    fn open_nat_does_not_start_udp_punch_tasks() {
        let tasks = collect(
            1,
            NatType::OpenInternet,
            P2pPolicyFlags::default(),
            vec![candidate(2, NatType::PortRestricted)],
        );

        assert!(tasks.is_empty());
    }

    #[test]
    fn lazy_p2p_allows_recent_traffic_without_need_p2p_flag() {
        let mut idle = candidate(2, NatType::PortRestricted);
        idle.feature_flag = Some(PeerFeatureFlag {
            need_p2p: false,
            ..Default::default()
        });

        let mut active = idle.clone();
        active.peer_id = 3;
        active.has_recent_traffic = true;

        let tasks = collect(
            1,
            NatType::PortRestricted,
            P2pPolicyFlags {
                lazy_p2p: true,
                ..Default::default()
            },
            vec![idle, active],
        );

        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].dst_peer_id, 3);
    }

    #[test]
    fn skips_blacklisted_and_directly_connected_candidates() {
        let mut direct = candidate(2, NatType::PortRestricted);
        direct.has_direct_connection = true;

        let tasks = collect_udp_punch_tasks(
            1,
            NatType::PortRestricted.into(),
            P2pPolicyFlags::default(),
            vec![direct, candidate(3, NatType::PortRestricted)],
            |peer_id| peer_id == 3,
        );

        assert!(tasks.is_empty());
    }

    #[test]
    fn filters_candidates_by_udp_nat_method() {
        let tasks = collect(
            1,
            NatType::PortRestricted,
            P2pPolicyFlags::default(),
            vec![
                candidate(2, NatType::Symmetric),
                candidate(3, NatType::PortRestricted),
            ],
        );

        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].dst_peer_id, 3);
        assert_eq!(tasks[0].dst_nat_type, NatType::PortRestricted.into());
    }

    #[test]
    fn easy_symmetric_pair_uses_lower_peer_id_as_initiator() {
        let tasks = collect(
            1,
            NatType::SymmetricEasyInc,
            P2pPolicyFlags::default(),
            vec![candidate(2, NatType::SymmetricEasyDec)],
        );
        assert_eq!(tasks.len(), 1);

        let tasks = collect(
            2,
            NatType::SymmetricEasyInc,
            P2pPolicyFlags::default(),
            vec![candidate(1, NatType::SymmetricEasyDec)],
        );
        assert!(tasks.is_empty());
    }

    #[test]
    fn mixed_symmetric_pair_is_started_only_by_hard_side_and_respects_policy() {
        for easy in [NatType::SymmetricEasyInc, NatType::SymmetricEasyDec] {
            assert_eq!(
                collect(
                    2,
                    NatType::Symmetric,
                    P2pPolicyFlags::default(),
                    vec![candidate(1, easy)]
                )
                .len(),
                1
            );
            assert!(
                collect(
                    1,
                    easy,
                    P2pPolicyFlags::default(),
                    vec![candidate(2, NatType::Symmetric)]
                )
                .is_empty()
            );
            assert!(
                collect(
                    2,
                    NatType::Symmetric,
                    P2pPolicyFlags {
                        disable_sym_hole_punching: true,
                        ..Default::default()
                    },
                    vec![candidate(1, easy)]
                )
                .is_empty()
            );
            assert!(
                collect(
                    2,
                    NatType::SymUdpFirewall,
                    P2pPolicyFlags::default(),
                    vec![candidate(1, easy)]
                )
                .is_empty()
            );
        }
    }

    #[test]
    fn disabling_symmetric_hole_punch_keeps_sym_to_cone_as_cone_method() {
        let tasks = collect(
            1,
            NatType::Symmetric,
            P2pPolicyFlags {
                disable_sym_hole_punching: true,
                ..Default::default()
            },
            vec![candidate(2, NatType::PortRestricted)],
        );

        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].dst_peer_id, 2);
    }
}
