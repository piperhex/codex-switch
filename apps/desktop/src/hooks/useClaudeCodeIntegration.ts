import { useCallback, useEffect, useState } from "react";
import {
  launchClaudeCode,
  loadAppSettings,
  restartClaudeCode,
  updateClaudeCodeWriteTarget,
} from "../api/backend";
import type { Translate } from "../i18n";
import type { ClaudeCodeWriteTarget } from "../types";

export function useClaudeCodeIntegration(notify: (message: string) => void, t: Translate) {
  const [target, setTarget] = useState<ClaudeCodeWriteTarget>("codex");
  const [busy, setBusy] = useState<"launch" | "restart" | null>(null);

  useEffect(() => {
    void loadAppSettings()
      .then((settings) => setTarget(settings.claudeCodeWriteTarget ?? "codex"))
      .catch((error) => notify(String(error)));
  }, [notify]);

  const changeTarget = useCallback(async (nextTarget: ClaudeCodeWriteTarget) => {
    try {
      const settings = await updateClaudeCodeWriteTarget(nextTarget);
      setTarget(settings.claudeCodeWriteTarget ?? nextTarget);
      notify(t("toast.claudeCodeWriteTargetSaved"));
    } catch (error) {
      notify(String(error));
    }
  }, [notify, t]);

  const launch = useCallback(async () => {
    setBusy("launch");
    try {
      const launched = await launchClaudeCode();
      notify(launched ? t("toast.claudeCodeLaunched") : t("toast.claudeCodeAlreadyRunning"));
    } catch (error) {
      notify(String(error));
    } finally {
      setBusy(null);
    }
  }, [notify, t]);

  const restart = useCallback(async () => {
    setBusy("restart");
    try {
      await restartClaudeCode();
      notify(t("toast.claudeCodeRestarted"));
    } catch (error) {
      notify(String(error));
    } finally {
      setBusy(null);
    }
  }, [notify, t]);

  return { busy, changeTarget, launch, restart, target };
}
