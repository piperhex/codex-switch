use std::collections::BTreeSet;
use std::net::{IpAddr, Ipv4Addr};

fn usable_ipv4_addresses(addresses: impl IntoIterator<Item = IpAddr>) -> Vec<String> {
    let mut unique = BTreeSet::from([Ipv4Addr::LOCALHOST]);
    for address in addresses {
        let IpAddr::V4(address) = address else {
            continue;
        };
        if !address.is_unspecified() && !address.is_multicast() && !address.is_broadcast() {
            unique.insert(address);
        }
    }
    let mut addresses = vec![Ipv4Addr::LOCALHOST.to_string()];
    addresses.extend(
        unique
            .into_iter()
            .filter(|address| *address != Ipv4Addr::LOCALHOST)
            .map(|address| address.to_string()),
    );
    addresses
}

fn local_ipv4_addresses() -> Vec<String> {
    let networks = sysinfo::Networks::new_with_refreshed_list();
    usable_ipv4_addresses(
        networks
            .values()
            .flat_map(|network| network.ip_networks().iter().map(|network| network.addr)),
    )
}

/// Enumerate addresses on demand without blocking the window or proxy status polling.
#[tauri::command]
pub(crate) async fn list_local_proxy_ipv4_addresses() -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(local_ipv4_addresses)
        .await
        .map_err(|_| "Unable to load local IPv4 addresses".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_all_unicast_ipv4_addresses_once_with_loopback_first() {
        let addresses = [
            IpAddr::V4(Ipv4Addr::new(192, 168, 1, 8)),
            IpAddr::V4(Ipv4Addr::new(10, 0, 0, 2)),
            IpAddr::V4(Ipv4Addr::new(192, 168, 1, 8)),
            IpAddr::V4(Ipv4Addr::new(169, 254, 1, 2)),
            IpAddr::V4(Ipv4Addr::LOCALHOST),
            IpAddr::V4(Ipv4Addr::UNSPECIFIED),
            IpAddr::V4(Ipv4Addr::BROADCAST),
            IpAddr::V4(Ipv4Addr::new(224, 0, 0, 1)),
            IpAddr::V6(std::net::Ipv6Addr::LOCALHOST),
        ];
        assert_eq!(
            usable_ipv4_addresses(addresses),
            ["127.0.0.1", "10.0.0.2", "169.254.1.2", "192.168.1.8"]
        );
        assert_eq!(usable_ipv4_addresses([]), ["127.0.0.1"]);
    }
}
