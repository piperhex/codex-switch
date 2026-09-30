use crate::{Error, Result};
use network_interface::{NetworkInterface, NetworkInterfaceConfig};

/// Enumerates usable unicast interface addresses without opening network connections.
pub fn local_addresses() -> Result<Vec<String>> {
    let interfaces = NetworkInterface::show().map_err(|_| Error::Unavailable)?;
    let mut addresses: Vec<_> = interfaces
        .into_iter()
        .flat_map(|interface| interface.addr)
        .map(|address| address.ip())
        .filter(|ip| usable(*ip))
        .map(|ip| ip.to_string())
        .collect();
    addresses.sort();
    addresses.dedup();
    Ok(addresses)
}

fn usable(ip: std::net::IpAddr) -> bool {
    if ip.is_loopback() || ip.is_unspecified() || ip.is_multicast() {
        return false;
    }
    match ip {
        std::net::IpAddr::V4(ip) => !ip.is_link_local(),
        std::net::IpAddr::V6(ip) => {
            ip.segments()[0] & 0xe000 == 0x2000 || ip.segments()[0] & 0xfe00 == 0xfc00
        }
    }
}
