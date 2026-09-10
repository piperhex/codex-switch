import { useEffect, useRef, useState } from "react";
import { loadLocalProxyIpv4Addresses, LOOPBACK_IPV4 } from "../api/proxyEndpoints";

export function useProxyEndpointAddresses(open: boolean) {
  const [addresses, setAddresses] = useState([LOOPBACK_IPV4]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const pending = useRef<Promise<string[]> | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    // Reuse an unfinished scan if the menu is quickly closed and reopened.
    pending.current ??= loadLocalProxyIpv4Addresses().finally(() => { pending.current = null; });
    void pending.current.then((result) => {
      if (!cancelled) setAddresses([...new Set([LOOPBACK_IPV4, ...result])]);
    }).catch(() => {
      if (!cancelled) {
        setAddresses([LOOPBACK_IPV4]);
        setFailed(true);
      }
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [open]);

  return { addresses, loading, failed };
}
