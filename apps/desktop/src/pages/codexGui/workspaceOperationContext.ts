import { createContext } from "react";

export const WorkspaceOperationContext = createContext({
  busy: false,
  setBusy: (_busy: boolean) => {},
});
