import type { ReactNode } from "react";

interface AccountTopbarActionsProps {
  children: ReactNode;
}

export function AccountTopbarActions({
  children,
}: AccountTopbarActionsProps) {
  return (
    <div className="account-topbar-controls">
      <div className="topbar-actions">{children}</div>
    </div>
  );
}
