use super::*;
use crate::{
    connectivity::hole_punch::udp::*,
    proto::common::{NatType, StunInfo},
    socket::udp::{UdpBindOptions, UdpSession, UdpSessionKind, VirtualUdpSocket},
};
use async_trait::async_trait;
use std::{
    collections::{HashMap, HashSet},
    io,
    sync::{
        Mutex, Weak,
        atomic::{AtomicUsize, Ordering},
    },
};
use tokio::sync::{Mutex as AsyncMutex, mpsc};

const BASE: u16 = 30000;
const HARD_IP: Ipv4Addr = Ipv4Addr::new(203, 0, 113, 10);
const EASY_IP: Ipv4Addr = Ipv4Addr::new(203, 0, 113, 20);
const PORT_SPACE: u32 = 64511;
const MAPPING_LIMIT: usize = 4096;
type Datagram = (Vec<u8>, SocketAddr);

// An endpoint-dependent mapper with a non-monotonic, collision-free public-port
// permutation. It accepts inbound packets only from the exact destination tuple.
#[derive(Default)]
struct Nat {
    mappings: HashMap<(u16, u16), u16>,
    receivers: HashMap<u16, mpsc::UnboundedSender<Datagram>>,
    allowed: HashSet<(u16, u16)>,
    sent: usize,
    blocked: bool,
    direction: bool,
    drift: u16,
}

impl Nat {
    fn mapped(&mut self, local: u16, remote: u16) -> u16 {
        let drift = u32::from(self.drift);
        *self.mappings.entry((local, remote)).or_insert_with(|| {
            let offset = u32::from(remote.abs_diff(BASE));
            // Fix a successful intersection late in the scan, not at the STUN port.
            let target = 127;
            let seed = (u32::from(scan_port(target)) - 1024 + PORT_SPACE
                - (((target + 1 + drift) * 16 + 1) * 4051) % PORT_SPACE)
                % PORT_SPACE;
            (1024 + (((offset * 16 + u32::from(local - 10000)) * 4051 + seed) % PORT_SPACE)) as u16
        })
    }

    fn deliver(&mut self, packet: Vec<u8>, destination: u16, source: u16) {
        if self.blocked {
            return;
        }
        self.allowed.insert((destination, source));
        for (&(local, remote), &public) in &self.mappings {
            if public == destination && remote == source {
                self.receivers[&local]
                    .send((packet.clone(), (EASY_IP, source).into()))
                    .unwrap();
            }
        }
    }
}

fn scan_port(index: u32) -> u16 {
    (1024 + ((index * 7919 + 17) % PORT_SPACE)) as u16
}

struct Socket {
    port: u16,
    nat: Arc<Mutex<Nat>>,
    incoming: AsyncMutex<mpsc::UnboundedReceiver<Datagram>>,
}

#[async_trait]
impl VirtualUdpSocket for Socket {
    fn local_addr(&self) -> io::Result<SocketAddr> {
        Ok(([192, 168, 1, 2], self.port).into())
    }
    async fn send_to(&self, data: &[u8], destination: SocketAddr) -> io::Result<usize> {
        let mut nat = self.nat.lock().unwrap();
        nat.sent += 1;
        let public = nat.mapped(self.port, destination.port());
        if data == b"roundtrip" && nat.allowed.contains(&(public, destination.port())) {
            nat.deliver(b"echo".to_vec(), public, destination.port());
        }
        Ok(data.len())
    }
    async fn recv_from(&self, output: &mut [u8]) -> io::Result<(usize, SocketAddr)> {
        let (data, source) = self.incoming.lock().await.recv().await.unwrap();
        output[..data.len()].copy_from_slice(&data);
        Ok((data.len(), source))
    }
}

struct Harness {
    nat: Arc<Mutex<Nat>>,
    sockets: Mutex<Vec<Weak<Socket>>>,
    connected: AtomicUsize,
    reject: bool,
    hang_rpc: bool,
    active_rpc: AtomicUsize,
}

struct RpcGuard<'a>(&'a AtomicUsize);

impl Drop for RpcGuard<'_> {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}

impl Harness {
    fn new(direction: bool, blocked: bool) -> Arc<Self> {
        Arc::new(Self {
            nat: Arc::new(Mutex::new(Nat {
                direction,
                blocked,
                ..Default::default()
            })),
            sockets: Mutex::new(Vec::new()),
            connected: AtomicUsize::new(0),
            reject: false,
            hang_rpc: false,
            active_rpc: AtomicUsize::new(0),
        })
    }
    fn attempt(self: &Arc<Self>) -> MixedPunch<Self, Self> {
        let nat = if self.nat.lock().unwrap().direction {
            NatType::SymmetricEasyInc
        } else {
            NatType::SymmetricEasyDec
        };
        MixedPunch {
            runtime: self.clone(),
            signaling: self.clone(),
            stun: self.clone(),
            target: UdpPunchTaskInfo {
                dst_peer_id: 2,
                my_nat_type: NatType::Symmetric.into(),
                dst_nat_type: nat.into(),
            },
            budget: MixedBudget::default(),
        }
    }
}

#[async_trait]
impl UdpHolePunchRuntime for Harness {
    type Socket = Socket;
    async fn bind_udp(&self, _: UdpBindOptions) -> anyhow::Result<Arc<Socket>> {
        let (tx, rx) = mpsc::unbounded_channel();
        let mut sockets = self.sockets.lock().unwrap();
        let port = 10000 + sockets.len() as u16;
        let socket = Arc::new(Socket {
            port,
            nat: self.nat.clone(),
            incoming: AsyncMutex::new(rx),
        });
        self.nat.lock().unwrap().receivers.insert(port, tx);
        sockets.push(Arc::downgrade(&socket));
        Ok(socket)
    }
    async fn resolve_udp_public_addr(
        &self,
        _: Arc<Socket>,
    ) -> anyhow::Result<UdpResolvedPublicAddr> {
        unreachable!("mixed client obtains a fresh remote mapping via authenticated signaling")
    }
    async fn create_listener(&self, _: bool) -> anyhow::Result<UdpPunchListener<Socket>> {
        unreachable!()
    }
    async fn create_port_bound_listener(&self, _: u16) -> anyhow::Result<UdpPunchListener<Socket>> {
        unreachable!()
    }
    async fn connect_with_socket(
        &self,
        socket: Arc<Socket>,
        remote: SocketAddr,
    ) -> anyhow::Result<UdpPunchSocket> {
        socket.send_to(b"roundtrip", remote).await?;
        let mut reply = [0; 32];
        let (len, source) =
            tokio::time::timeout(Duration::from_millis(100), socket.recv_from(&mut reply))
                .await??;
        anyhow::ensure!(
            source == remote && &reply[..len] == b"echo",
            "no bidirectional path"
        );
        self.connected.fetch_add(1, Ordering::SeqCst);
        let session = UdpSession::identity_standalone(socket, remote, UdpSessionKind::EasyTierMux)?;
        Ok(UdpPunchSocket::new(session, remote, ()))
    }
}

#[async_trait]
impl StunInfoProvider for Harness {
    fn get_stun_info(&self) -> StunInfo {
        StunInfo {
            public_ip: vec![HARD_IP.to_string()],
            ..Default::default()
        }
    }
    async fn get_udp_port_mapping(&self, _: u16) -> anyhow::Result<SocketAddr> {
        unreachable!()
    }
    async fn get_tcp_port_mapping(&self, _: u16) -> anyhow::Result<SocketAddr> {
        unreachable!()
    }
    fn update_stun_info(&self) {}
}

#[async_trait]
impl UdpHolePunchSignaling for Harness {
    async fn select_punch_listener(
        &self,
        _: u32,
        request: SelectPunchListener,
    ) -> Result<SelectPunchListenerResponse, UdpHolePunchSignalError> {
        assert!(request.force_new);
        assert!(!request.prefer_port_mapping);
        if self.reject {
            return Err(UdpHolePunchSignalError::InvalidServiceKey);
        }
        Ok(SelectPunchListenerResponse {
            listener_mapped_addr: (EASY_IP, BASE).into(),
        })
    }
    async fn send_punch_packet_hard_sym(
        &self,
        _: u32,
        request: SendPunchPacketHardSym,
    ) -> Result<SendPunchPacketHardSymResponse, UdpHolePunchSignalError> {
        assert_eq!(request.round, REMOTE_BUDGET_ROUND);
        self.active_rpc.fetch_add(1, Ordering::SeqCst);
        let _guard = RpcGuard(&self.active_rpc);
        if self.hang_rpc {
            return std::future::pending().await;
        }
        let packet =
            new_hole_punch_packet(request.transaction_id, HOLE_PUNCH_PACKET_BODY_LEN).into_bytes();
        for index in 0..190 {
            let mut nat = self.nat.lock().unwrap();
            let delta = index as u16 + 1 + nat.drift;
            let source = if nat.direction {
                BASE + delta
            } else {
                BASE - delta
            };
            nat.deliver(packet.to_vec(), scan_port(index), source);
        }
        tokio::task::yield_now().await;
        Ok(SendPunchPacketHardSymResponse {
            next_port_index: 190,
        })
    }
    async fn send_punch_packet_cone(
        &self,
        _: u32,
        _: SendPunchPacketCone,
    ) -> Result<(), UdpHolePunchSignalError> {
        unreachable!()
    }
    async fn send_punch_packet_easy_sym(
        &self,
        _: u32,
        _: SendPunchPacketEasySym,
    ) -> Result<(), UdpHolePunchSignalError> {
        unreachable!()
    }
    async fn send_punch_packet_both_easy_sym(
        &self,
        _: u32,
        _: SendPunchPacketBothEasySym,
    ) -> Result<SendPunchPacketBothEasySymResponse, UdpHolePunchSignalError> {
        unreachable!()
    }
}

#[tokio::test]
async fn mixed_nat_roundtrip_uses_observed_port_and_same_socket_for_both_directions() {
    for incremental in [true, false] {
        let harness = Harness::new(incremental, false);
        let socket = harness.attempt().run().await.unwrap();
        assert!(
            socket.is_some(),
            "mixed endpoint-dependent mappings must carry a round trip"
        );
        assert_eq!(harness.connected.load(Ordering::SeqCst), 1);
        let nat = harness.nat.lock().unwrap();
        assert_eq!(nat.mappings.len(), MAPPING_LIMIT);
        assert!(nat.sent <= MAPPING_LIMIT * 3 + 1);
    }
}

#[tokio::test]
async fn failed_mixed_attempt_is_bounded_and_releases_all_sockets() {
    let harness = Harness::new(true, true);
    assert!(harness.attempt().run().await.unwrap().is_none());
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert_eq!(harness.connected.load(Ordering::SeqCst), 0);
    assert!(
        harness
            .sockets
            .lock()
            .unwrap()
            .iter()
            .all(|socket| socket.upgrade().is_none())
    );
}

#[tokio::test]
async fn cancellation_releases_socket_matrix_without_waiting_for_remote() {
    let harness = Harness::new(true, true);
    let attempt = harness.attempt();
    let task = tokio::spawn(async move { attempt.run().await });
    while harness.sockets.lock().unwrap().is_empty() {
        tokio::task::yield_now().await;
    }
    task.abort();
    assert!(task.await.unwrap_err().is_cancelled());
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert!(
        harness
            .sockets
            .lock()
            .unwrap()
            .iter()
            .all(|socket| socket.upgrade().is_none())
    );
}

#[tokio::test]
async fn rejected_signaling_never_allocates_or_sends_probe_packets() {
    let mut harness = Harness::new(true, false);
    Arc::get_mut(&mut harness).unwrap().reject = true;
    assert!(harness.attempt().run().await.is_err());
    assert!(harness.sockets.lock().unwrap().is_empty());
    assert_eq!(harness.nat.lock().unwrap().sent, 0);
}

#[tokio::test(start_paused = true)]
async fn hung_rpc_is_cancelled_at_attempt_deadline_and_on_disconnect() {
    for disconnect in [false, true] {
        let mut harness = Harness::new(true, true);
        Arc::get_mut(&mut harness).unwrap().hang_rpc = true;
        let attempt = harness.attempt();
        let started = tokio::time::Instant::now();
        let task = tokio::spawn(async move { attempt.run().await });
        tokio::time::timeout(ATTEMPT_TIMEOUT, async {
            while harness.active_rpc.load(Ordering::SeqCst) == 0 {
                tokio::time::sleep(RESPONSE_POLL).await;
            }
        })
        .await
        .expect("probe RPC must start within the attempt budget");
        if disconnect {
            task.abort();
            assert!(task.await.unwrap_err().is_cancelled());
        } else {
            assert!(task.await.unwrap().unwrap().is_none());
            assert!(started.elapsed() <= ATTEMPT_TIMEOUT + RESPONSE_POLL);
        }
        tokio::time::sleep(RESPONSE_POLL).await;
        assert_eq!(harness.active_rpc.load(Ordering::SeqCst), 0);
        assert!(
            harness
                .sockets
                .lock()
                .unwrap()
                .iter()
                .all(|s| s.upgrade().is_none())
        );
    }
}

#[test]
fn port_prediction_stays_in_range_without_wrapping_or_port_zero() {
    assert_eq!(predicted_ports(65533, true, 1024), [65534, 65535]);
    assert_eq!(predicted_ports(3, false, 1024), [2, 1]);
    assert!(predicted_ports(65535, true, 1024).is_empty());
    assert!(predicted_ports(1, false, 1024).is_empty());
}

#[tokio::test(start_paused = true)]
async fn wider_predictions_handle_drift_without_increasing_mapping_budget() {
    for incremental in [true, false] {
        for (drift, budget) in [(300, MixedBudget::Wider), (700, MixedBudget::Widest)] {
            let harness = Harness::new(incremental, false);
            harness.nat.lock().unwrap().drift = drift;
            // No source port fits in the first window, even if random hard ports collide.
            assert!(harness.attempt().run().await.unwrap().is_none());
            let harness = Harness::new(incremental, false);
            harness.nat.lock().unwrap().drift = drift;
            let mut attempt = harness.attempt();
            attempt.budget = budget;
            assert!(attempt.run().await.unwrap().is_some());
            let nat = harness.nat.lock().unwrap();
            assert_eq!(nat.mappings.len(), MAPPING_LIMIT);
            assert!(nat.sent <= MAPPING_LIMIT * 3 + 1);
        }
    }
}

#[test]
fn public_candidates_are_bounded_deduplicated_and_exclude_private_addresses() {
    let ips = [
        "127.0.0.1",
        "192.168.1.2",
        "::1",
        "224.0.0.1",
        "0.0.0.0",
        "203.0.113.1",
        "203.0.113.1",
        "203.0.113.2",
        "203.0.113.3",
    ]
    .map(str::to_string);
    assert_eq!(
        usable_public_ips(&ips),
        [Ipv4Addr::new(203, 0, 113, 1), Ipv4Addr::new(203, 0, 113, 2)]
    );
}
