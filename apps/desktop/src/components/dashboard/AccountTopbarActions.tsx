import type { ReactNode } from "react";

interface AccountTopbarActionsProps {
  children: ReactNode;
}

export function AccountTopbarActions({
  children,
}: AccountTopbarActionsProps) {
  return (
    <div className="account-topbar-controls" data-tauri-drag-region>
      <div className="topbar-actions" data-tauri-drag-region>{children}</div>
    </div>
  );
}
