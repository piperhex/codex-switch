import type { ReactNode } from "react";
import type { Translate } from "../../i18n";
import type {
  Account,
  ImageModelTarget,
  ImageRouteKind,
  LocalProxyStatus,
  Provider,
} from "../../types";
import { ImageModelRouteSelect } from "../ImageModelRouteSelect";

interface AccountTopbarActionsProps {
  accounts: Account[];
  children: ReactNode;
  localProxy: LocalProxyStatus | null;
  onImageModelChange: (routeKind: ImageRouteKind, target: ImageModelTarget | null) => void;
  privacyMode: boolean;
  providers: Provider[];
  proxyBusy: boolean;
  t: Translate;
}

export function AccountTopbarActions({
  accounts,
  children,
  localProxy,
  onImageModelChange,
  privacyMode,
  providers,
  proxyBusy,
  t,
}: AccountTopbarActionsProps) {
  return (
    <div className="account-topbar-controls">
      <div className="topbar-actions">{children}</div>
      {localProxy?.running && (
        <div className="proxy-image-model-fields">
          <ImageModelRouteSelect accounts={accounts} providers={providers} routeKind="input"
            target={localProxy.imageInputTarget} busy={proxyBusy}
            onChange={onImageModelChange} privacyMode={privacyMode} t={t} />
          <ImageModelRouteSelect accounts={accounts} providers={providers} routeKind="output"
            target={localProxy.imageOutputTarget} busy={proxyBusy}
            onChange={onImageModelChange} privacyMode={privacyMode} t={t} />
        </div>
      )}
    </div>
  );
}
