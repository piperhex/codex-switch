//! Only the counterpart of this native chat grant is reachable; there is no general UDP proxy.
use crate::RouteStatus;
use async_trait::async_trait;
use easytier::instance::factory::NativeCoreInstance;
use easytier_core::gateway::DataPlaneUdpSocket;
use std::{
    any::Any,
    net::{IpAddr, SocketAddr},
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
    time::Duration,
};
use tokio::sync::watch;
use turn::relay::RelayAddressGenerator;
use webrtc_util::{Conn, Error, Result};

pub(super) struct Generator {
    engine: Arc<NativeCoreInstance>,
    peer: IpAddr,
    route: watch::Receiver<RouteStatus>,
    allocations: Arc<AtomicUsize>,
    lifetime: super::Lifetime,
}

impl Generator {
    pub fn new(
        engine: Arc<NativeCoreInstance>,
        peer: IpAddr,
        route: watch::Receiver<RouteStatus>,
        lifetime: super::Lifetime,
    ) -> Self {
        Self {
            engine,
            peer,
            route,
            lifetime,
            allocations: Arc::new(AtomicUsize::new(0)),
        }
    }
}

#[async_trait]
impl RelayAddressGenerator for Generator {
    fn validate(&self) -> std::result::Result<(), turn::Error> {
        Ok(())
    }
    async fn allocate_conn(
        &self,
        ipv4: bool,
        requested_port: u16,
    ) -> std::result::Result<(Arc<dyn Conn + Send + Sync>, SocketAddr), turn::Error> {
        if !ipv4 || requested_port != 0 || self.lifetime.closed() {
            return Err(turn::Error::ErrFakeErr);
        }
        let allocation = Allocation::reserve(self.allocations.clone())?;
        let mut lifetime = self.lifetime.clone();
        let socket = tokio::select! {
            _ = lifetime.finished() => return Err(turn::Error::ErrFakeErr),
            result = self.engine.data_plane_udp_bind(0, Duration::from_secs(2)) =>
                result.map_err(|_| turn::Error::ErrFakeErr)?,
        };
        socket
            .allow_peer(self.peer)
            .map_err(|_| turn::Error::ErrFakeErr)?;
        let address = socket.local_addr();
        let connection = MediaSocket {
            socket,
            peer: self.peer,
            route: self.route.clone(),
            closed: watch::channel(false).0,
            lifetime,
            _allocation: allocation,
        };
        Ok((Arc::new(connection), address))
    }
}

struct MediaSocket {
    socket: DataPlaneUdpSocket,
    peer: IpAddr,
    route: watch::Receiver<RouteStatus>,
    closed: watch::Sender<bool>,
    lifetime: super::Lifetime,
    _allocation: Allocation,
}

fn denied() -> Error {
    std::io::Error::from(std::io::ErrorKind::PermissionDenied).into()
}
impl MediaSocket {
    fn allows(&self, peer: SocketAddr) -> bool {
        peer.ip() == self.peer
            && peer.port() >= 1024
            && self.route.borrow().direct
            && !*self.closed.borrow()
            && !self.lifetime.closed()
    }
}

#[async_trait]
impl Conn for MediaSocket {
    async fn connect(&self, _: SocketAddr) -> Result<()> {
        Err(denied())
    }
    async fn recv(&self, _: &mut [u8]) -> Result<usize> {
        Err(denied())
    }
    async fn send(&self, _: &[u8]) -> Result<usize> {
        Err(denied())
    }
    async fn recv_from(&self, buffer: &mut [u8]) -> Result<(usize, SocketAddr)> {
        let mut closed = self.closed.subscribe();
        let mut lifetime = self.lifetime.clone();
        loop {
            if *closed.borrow() {
                return Err(denied());
            }
            let (length, source) = tokio::select! {
                _ = closed.changed() => return Err(denied()),
                _ = lifetime.finished() => return Err(denied()),
                result = self.socket.recv_from(buffer) => result?,
            };
            if self.allows(source) {
                return Ok((length, source));
            }
        }
    }
    async fn send_to(&self, buffer: &[u8], peer: SocketAddr) -> Result<usize> {
        if !self.allows(peer) {
            return Err(denied());
        }
        Ok(self.socket.send_to(buffer, peer).await?)
    }
    fn local_addr(&self) -> Result<SocketAddr> {
        Ok(self.socket.local_addr())
    }
    fn remote_addr(&self) -> Option<SocketAddr> {
        None
    }
    async fn close(&self) -> Result<()> {
        self.closed.send_replace(true);
        Ok(())
    }
    fn as_any(&self) -> &(dyn Any + Send + Sync) {
        self
    }
}

/// Releases a slot even if allocating the data-plane socket is canceled midway.
struct Allocation(Arc<AtomicUsize>);
impl Allocation {
    fn reserve(count: Arc<AtomicUsize>) -> std::result::Result<Self, turn::Error> {
        let mut current = count.load(Ordering::Acquire);
        while current < super::MAX_ALLOCATIONS {
            match count.compare_exchange_weak(
                current,
                current + 1,
                Ordering::AcqRel,
                Ordering::Acquire,
            ) {
                Ok(_) => return Ok(Self(count)),
                Err(actual) => current = actual,
            }
        }
        Err(turn::Error::ErrFakeErr)
    }
}
impl Drop for Allocation {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::AcqRel);
    }
}
