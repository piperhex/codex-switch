//! A closed WebRTC probe must not stop the adapter shared by other ICE allocations.
use async_trait::async_trait;
use std::{any::Any, io::ErrorKind, net::SocketAddr};
use tokio::net::UdpSocket;
use webrtc_util::{Conn, Result};

pub(super) struct LocalSocket(pub UdpSocket);

#[async_trait]
impl Conn for LocalSocket {
    async fn connect(&self, peer: SocketAddr) -> Result<()> {
        Ok(self.0.connect(peer).await?)
    }
    async fn recv(&self, buffer: &mut [u8]) -> Result<usize> {
        Ok(self.0.recv(buffer).await?)
    }
    async fn send(&self, buffer: &[u8]) -> Result<usize> {
        Ok(self.0.send(buffer).await?)
    }
    async fn recv_from(&self, buffer: &mut [u8]) -> Result<(usize, SocketAddr)> {
        loop {
            match self.0.recv_from(buffer).await {
                Ok(packet) => return Ok(packet),
                // Windows reports ICMP from an already closed probe on this shared UDP listener.
                Err(error)
                    if matches!(
                        error.kind(),
                        ErrorKind::ConnectionReset
                            | ErrorKind::ConnectionRefused
                            | ErrorKind::Interrupted
                    ) =>
                {
                    continue
                }
                Err(error) => return Err(error.into()),
            }
        }
    }
    async fn send_to(&self, buffer: &[u8], peer: SocketAddr) -> Result<usize> {
        Ok(self.0.send_to(buffer, peer).await?)
    }
    fn local_addr(&self) -> Result<SocketAddr> {
        Ok(self.0.local_addr()?)
    }
    fn remote_addr(&self) -> Option<SocketAddr> {
        self.0.peer_addr().ok()
    }
    async fn close(&self) -> Result<()> {
        // TURN's cancellation channel stops reads and drops the owning Arc/UdpSocket.
        Ok(())
    }
    fn as_any(&self) -> &(dyn Any + Send + Sync) {
        self
    }
}
