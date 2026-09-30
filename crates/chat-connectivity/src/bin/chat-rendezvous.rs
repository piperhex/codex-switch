//! Dedicated discovery coordinator. Application data relaying is disabled on this node.
use easytier::{
    common::config::{ConfigLoader, NetworkIdentity, TomlConfig},
    instance::factory::create_native_instance,
};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let secret =
        std::env::var("CHAT_RENDEZVOUS_SECRET").map_err(|_| "Missing rendezvous secret")?;
    if secret.len() < 32 {
        return Err("Rendezvous secret must contain at least 32 characters".into());
    }
    let config = TomlConfig::default();
    config.set_inst_name("chat-rendezvous".into());
    config.set_hostname(Some("chat-rendezvous".into()));
    config.set_network_identity(NetworkIdentity::new("csw-coordinator".into(), secret));
    config.set_listeners(
        [
            "udp://0.0.0.0:11010",
            "tcp://0.0.0.0:11010",
            "udp://[::]:11010",
            "tcp://[::]:11010",
        ]
        .iter()
        .map(|value| value.parse())
        .collect::<Result<_, _>>()?,
    );
    let mut flags = config.get_flags();
    flags.no_tun = true;
    flags.enable_ipv6 = true;
    flags.enable_encryption = true;
    flags.disable_upnp = true;
    flags.disable_relay_data = true;
    flags.relay_network_whitelist = "csw-*".into();
    flags.accept_dns = false;
    config.set_flags(flags);
    let engine = tokio::task::spawn_blocking(move || create_native_instance(config))
        .await?
        .map_err(|_| "Rendezvous initialization failed")?;
    if engine.start().await.is_err() {
        engine.stop().await;
        return Err("Rendezvous startup failed".into());
    }
    shutdown().await?;
    engine.stop().await;
    Ok(())
}

async fn shutdown() -> std::io::Result<()> {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{signal, SignalKind};
        let mut terminate = signal(SignalKind::terminate())?;
        tokio::select! { result = tokio::signal::ctrl_c() => result, _ = terminate.recv() => Ok(()) }
    }
    #[cfg(not(unix))]
    tokio::signal::ctrl_c().await
}
