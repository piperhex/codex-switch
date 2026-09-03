import { Popover } from "antd";
import { ChevronDown, Image as ImageIcon } from "lucide-react";
import type { Translate } from "../../i18n";
import type {
  Account,
  ImageModelTarget,
  ImageRouteKind,
  Provider,
} from "../../types";
import { ImageModelRouteSelect } from "../ImageModelRouteSelect";

interface AccountImageModelButtonProps {
  accounts: Account[];
  providers: Provider[];
  inputTarget: ImageModelTarget | null | undefined;
  outputTarget: ImageModelTarget | null | undefined;
  busy: boolean;
  onChange: (routeKind: ImageRouteKind, target: ImageModelTarget | null) => void;
  privacyMode: boolean;
  t: Translate;
}

export function AccountImageModelButton(options: AccountImageModelButtonProps) {
  const configured = Boolean(options.inputTarget || options.outputTarget);
  const label = options.t(configured
    ? "providers.proxy.customImageModelConfigured"
    : "providers.proxy.customImageModel");
  const content = (
    <div className="account-image-model-popover">
      <ImageModelRouteSelect accounts={options.accounts} providers={options.providers} routeKind="input"
        target={options.inputTarget} busy={options.busy} onChange={options.onChange}
        privacyMode={options.privacyMode} t={options.t} />
      <ImageModelRouteSelect accounts={options.accounts} providers={options.providers} routeKind="output"
        target={options.outputTarget} busy={options.busy} onChange={options.onChange}
        privacyMode={options.privacyMode} t={options.t} />
    </div>
  );

  return (
    <Popover trigger="click" placement="bottomRight" content={content}
      styles={{ root: { maxWidth: 400 } }}>
      <button type="button" className={`refresh-all proxy-topbar-action${configured ? " active" : ""}`}
        aria-label={label}>
        <ImageIcon size={14} />
        <span>{label}</span>
        <ChevronDown size={12} />
      </button>
    </Popover>
  );
}
