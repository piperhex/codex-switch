export type CodexConnectionState = "connected" | "disconnected" | "connecting" | "unsupported";

export interface CodexConnectionStatus {
  state: CodexConnectionState;
}

export interface CodexConnectResult extends CodexConnectionStatus {
  restartRequired: boolean;
}
