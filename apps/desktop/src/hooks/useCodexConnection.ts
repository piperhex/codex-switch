import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { connectCodex, loadCodexConnectionStatus, restartChatGpt } from "../api/backend";
import type { Translate } from "../i18n";
import { CodexConnectionController, type ParentClientOperation } from "./codexConnectionController";

const CONNECTION_POLL_INTERVAL_MS = 5_000;

interface CodexConnectionOptions {
  blocked: boolean;
  onOperationChange: (operation: ParentClientOperation) => void;
  notify: (message: string) => void;
  t: Translate;
}

export function useCodexConnection(options: CodexConnectionOptions) {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const [controller] = useState(() => new CodexConnectionController({
    loadStatus: loadCodexConnectionStatus,
    connect: connectCodex,
    restart: restartChatGpt,
    isBlocked: () => optionsRef.current.blocked,
    isVisible: () => document.visibilityState !== "hidden",
    onOperationChange: (operation) => optionsRef.current.onOperationChange(operation),
    onError: (operation) => {
      const { notify, t } = optionsRef.current;
      notify(t(operation === "connect" ? "codexConnection.connectFailed" : "codexConnection.restartFailed"));
    },
  }));
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);

  useEffect(() => {
    controller.activate();
    const timer = window.setInterval(() => void controller.refresh(), CONNECTION_POLL_INTERVAL_MS);
    document.addEventListener("visibilitychange", controller.availabilityChanged);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", controller.availabilityChanged);
      controller.dispose();
    };
  }, [controller]);

  useEffect(() => {
    controller.availabilityChanged();
  }, [controller, options.blocked]);

  return {
    ...snapshot,
    connect: controller.connect,
    confirmRestart: controller.confirmRestart,
    cancelRestart: controller.cancelRestart,
  };
}
