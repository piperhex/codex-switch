import { hasLocalBackend, invoke } from "./backend";

export const LOOPBACK_IPV4 = "127.0.0.1";

export async function loadLocalProxyIpv4Addresses(): Promise<string[]> {
  if (!hasLocalBackend) return [LOOPBACK_IPV4];
  return invoke<string[]>("list_local_proxy_ipv4_addresses");
}
