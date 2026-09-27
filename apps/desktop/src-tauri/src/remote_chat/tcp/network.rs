use super::{
    authority::Address,
    service::{Event, Group, SocketCommand, MAX_SOCKETS},
    Error, Result,
};
use std::{
    net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr},
    sync::Arc,
    time::Duration,
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{lookup_host, TcpSocket, TcpStream},
    sync::{mpsc, watch},
};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(8);
const READ_BYTES: usize = 32 * 1024;

fn socket(ipv6: bool, port: u16) -> Result<TcpSocket> {
    let socket = if ipv6 {
        TcpSocket::new_v6()?
    } else {
        TcpSocket::new_v4()?
    };
    socket.set_reuseaddr(true)?;
    // Unix rejects sharing an active listener with SO_REUSEADDR alone; Windows does not expose SO_REUSEPORT.
    #[cfg(unix)]
    socket.set_reuseport(true)?;
    let ip = if ipv6 {
        IpAddr::V6(Ipv6Addr::UNSPECIFIED)
    } else {
        IpAddr::V4(Ipv4Addr::UNSPECIFIED)
    };
    socket.bind(SocketAddr::new(ip, port))?;
    Ok(socket)
}

pub(super) async fn listen(group: Arc<Group>, ipv6: bool) -> Result<u16> {
    let mut listeners = group.listeners.lock().await;
    if let Some((port, _)) = listeners.get(&ipv6) {
        return Ok(*port);
    }
    let listener = socket(ipv6, 0)?.listen(8)?;
    let port = listener.local_addr()?.port();
    let (stop, mut stopped) = watch::channel(false);
    listeners.insert(ipv6, (port, stop));
    drop(listeners);
    tokio::spawn(async move {
        loop {
            let accepted = tokio::select! {
                _ = group.stopped() => break,
                _ = stopped.changed() => break,
                accepted = listener.accept() => accepted,
            };
            let Ok((stream, _)) = accepted else { break };
            // Unauthenticated inbound sockets have bounded slots and a five-second protocol handshake above IPC.
            if let Err(error) = attach(group.clone(), stream, true).await {
                eprintln!("TCP peer admission: {error}");
            }
        }
    });
    Ok(port)
}

pub(super) async fn connect(group: Arc<Group>, address: Address, ipv6: bool) -> Result<String> {
    let port = group
        .listeners
        .lock()
        .await
        .get(&ipv6)
        .map(|entry| entry.0)
        .ok_or(Error::Closed)?;
    let (id, receiver) = reserve(&group).await?;
    let connected = tokio::select! {
        _ = group.stopped() => Err(Error::Closed),
        result = tokio::time::timeout(CONNECT_TIMEOUT, dial(address, ipv6, port)) =>
            result.map_err(|_| Error::Closed).and_then(|result| result),
    };
    match connected {
        Ok(stream) => {
            if let Err(error) = start(group.clone(), stream, (id.clone(), receiver), false) {
                group.sockets.lock().await.remove(&id);
                return Err(error);
            }
            Ok(id)
        }
        Err(error) => {
            group.sockets.lock().await.remove(&id);
            Err(error)
        }
    }
}

async fn dial(address: Address, ipv6: bool, port: u16) -> Result<TcpStream> {
    let remote = lookup_host((address.host.as_str(), address.port))
        .await?
        .find(|candidate| candidate.is_ipv6() == ipv6)
        .ok_or(Error::Invalid)?;
    Ok(socket(ipv6, port)?.connect(remote).await?)
}

async fn reserve(group: &Group) -> Result<(String, mpsc::Receiver<SocketCommand>)> {
    let mut sockets = group.sockets.lock().await;
    if sockets.len() >= MAX_SOCKETS {
        return Err(Error::Closed);
    }
    let id = uuid::Uuid::new_v4().to_string();
    let (sender, receiver) = mpsc::channel(4);
    sockets.insert(id.clone(), sender);
    Ok((id, receiver))
}

async fn attach(group: Arc<Group>, stream: TcpStream, incoming: bool) -> Result<()> {
    let (id, receiver) = reserve(&group).await?;
    if let Err(error) = start(group.clone(), stream, (id.clone(), receiver), incoming) {
        group.sockets.lock().await.remove(&id);
        return Err(error);
    }
    Ok(())
}

fn start(
    group: Arc<Group>,
    stream: TcpStream,
    delivery: (String, mpsc::Receiver<SocketCommand>),
    incoming: bool,
) -> Result<()> {
    let (id, receiver) = delivery;
    stream.set_nodelay(true)?;
    let local = stream.local_addr()?;
    group.emit(Event::Open {
        socket_id: id.clone(),
        local_address: local.ip().to_string(),
        local_port: local.port(),
        incoming,
    })?;
    tokio::spawn(async move {
        let result = pump(&group, &id, stream, receiver).await;
        group.sockets.lock().await.remove(&id);
        if let Err(error) = result {
            eprintln!("TCP peer closed: {error}");
        }
        if group.emit(Event::Closed { socket_id: id }).is_err() {
            group.cancel.send_replace(true);
        }
    });
    Ok(())
}

async fn pump(
    group: &Group,
    id: &str,
    stream: TcpStream,
    mut commands: mpsc::Receiver<SocketCommand>,
) -> Result<()> {
    let (mut reader, mut writer) = stream.into_split();
    let mut buffer = vec![0; READ_BYTES];
    let mut pending = false;
    let mut read_deadline = tokio::time::Instant::now() + CONNECT_TIMEOUT;
    loop {
        tokio::select! {
            _ = group.stopped() => return Ok(()),
            _ = tokio::time::sleep_until(read_deadline), if pending => return Err(Error::Closed),
            command = commands.recv() => match command {
                Some(SocketCommand::Write(data, written)) => {
                    tokio::time::timeout(CONNECT_TIMEOUT, writer.write_all(&data)).await
                        .map_err(|_| Error::Closed)??;
                    // A dropped receiver means the frontend already canceled the write.
                    if written.send(()).is_err() { return Ok(()); }
                },
                Some(SocketCommand::Ack) => pending = false,
                Some(SocketCommand::Close) | None => return Ok(()),
            },
            read = reader.read(&mut buffer), if !pending => {
                let length = read?;
                if length == 0 { return Ok(()); }
                group.emit(Event::Data { socket_id: id.into(), data: buffer[..length].to_vec() })?;
                pending = true;
                read_deadline = tokio::time::Instant::now() + CONNECT_TIMEOUT;
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::net::TcpListener;

    #[tokio::test]
    async fn discovery_and_peer_dials_reuse_the_listening_port() {
        let rendezvous = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let peer = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let listener = socket(false, 0).unwrap().listen(8).unwrap();
        let local_port = listener.local_addr().unwrap().port();
        let destination = |listener: &TcpListener| Address {
            host: "127.0.0.1".into(),
            port: listener.local_addr().unwrap().port(),
        };
        let discovery = dial(destination(&rendezvous), false, local_port)
            .await
            .unwrap();
        let (_, observed) = rendezvous.accept().await.unwrap();
        assert_eq!(observed.port(), local_port);
        let mut outgoing = dial(destination(&peer), false, local_port).await.unwrap();
        let (mut incoming, observed) = peer.accept().await.unwrap();
        assert_eq!(observed.port(), local_port);
        outgoing.write_all(b"punch").await.unwrap();
        let mut bytes = [0; 5];
        incoming.read_exact(&mut bytes).await.unwrap();
        assert_eq!(&bytes, b"punch");
        drop(discovery);
    }
}
