import { useState } from "react";
import { Dropdown, type MenuProps } from "antd";
import { Copy } from "lucide-react";
import { useProxyEndpointAddresses } from "../../hooks/useProxyEndpointAddresses";
import type { Translate } from "../../i18n";
import type { LocalProxyStatus } from "../../types";
import "./ProxyCopyDropdown.css";

interface ProxyCopyDropdownProps {
  proxy: LocalProxyStatus;
  busy: boolean;
  copyApiKey: () => Promise<void>;
  notify: (message: string) => void;
  t: Translate;
}

export function ProxyCopyDropdown({ proxy, busy, copyApiKey, notify, t }: ProxyCopyDropdownProps) {
  const [open, setOpen] = useState(false);
  const { addresses, loading, failed } = useProxyEndpointAddresses(open);
  const endpoints = addresses.map((address) => `http://${address}:${proxy.port}/v1`);
  const copyEndpoint = async (endpoint: string) => {
    try {
      await navigator.clipboard.writeText(endpoint);
      notify(t("providers.proxy.endpointCopied"));
    } catch {
      notify(t("providers.proxy.endpointCopyFailed"));
    }
  };
  const items: MenuProps["items"] = [
    { key: "endpoints", label: t("providers.proxy.copyEndpoint"), popupClassName: "proxy-copy-dropdown",
      children: [
        ...endpoints.map((endpoint) => ({ key: endpoint, label: endpoint, disabled: !proxy.port })),
        ...(loading ? [{ key: "loading", label: t("providers.proxy.loadingAddresses"), disabled: true }] : []),
        ...(failed ? [{ key: "failed", label: t("providers.proxy.addressesFailed"), disabled: true }] : []),
        ...(!proxy.listenOnAllInterfaces
          ? [{ key: "lan-disabled", label: t("providers.proxy.endpointLanHint"), disabled: true }] : []),
      ] },
    { key: "api-key", label: t(proxy.hasLanApiKey
      ? "providers.proxy.copyLanApiKey" : "providers.proxy.copyLanApiKeyUnavailable"),
      disabled: busy || !proxy.hasLanApiKey },
  ];

  return (
    <Dropdown trigger={["hover", "click"]} placement="bottomRight" open={open}
      onOpenChange={setOpen} overlayClassName="proxy-copy-dropdown"
      menu={{ items, onClick: ({ key }) => {
        setOpen(false);
        if (key === "api-key") void copyApiKey();
        else if (endpoints.includes(key)) void copyEndpoint(key);
      } }}>
      <button type="button" className="window-titlebar-proxy-lan-copy"
        aria-label={t("providers.proxy.copyMenu")} aria-haspopup="menu" aria-expanded={open}>
        <Copy size={12} aria-hidden="true" />
      </button>
    </Dropdown>
  );
}
