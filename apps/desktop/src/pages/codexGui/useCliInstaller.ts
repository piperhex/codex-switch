import { useCallback, useEffect, useRef, useState } from "react";
import { invoke, isDesktopApp } from "../../api/backend";
import { listen } from "@tauri-apps/api/event";
import type { GuiController } from "./controller";

interface Release { version: string; size: number }
interface Progress { downloaded: number; total: number; phase: "downloading" | "installing" }

export function useCliInstaller(active: boolean, controller: Pick<GuiController, "report" | "clearError" | "connect">) {
  const [version, setVersion] = useState<string | null>(null);
  const [release, setRelease] = useState<Release | null>(null);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [checked, setChecked] = useState(false);
  const started = useRef(false);
  const busy = useRef(false);
  const check = useCallback(async () => {
    setChecking(true);
    try { setRelease(await invoke<Release>("codex_gui_cli_release")); }
    catch (error) { controller.report(error); }
    finally { setChecking(false); }
  }, [controller]);

  useEffect(() => {
    if (!active || started.current) return;
    let cancelled = false;
    queueMicrotask(async () => {
      if (cancelled) return;
      started.current = true;
      try {
        const installed = await invoke<{ version: string | null }>("codex_gui_cli_status");
        setVersion(installed.version);
        setChecked(true);
        if (installed.version) await controller.connect();
        else await check();
      } catch (error) { setChecked(true); controller.report(error); }
    });
    return () => { cancelled = true; };
  }, [active, check, controller]);

  useEffect(() => {
    if (!active || !isDesktopApp) return;
    let cancelled = false;
    const subscription = listen<Progress>("codex-gui-download", ({ payload }) => setProgress(payload));
    void subscription.then((stop) => { if (cancelled) stop(); }).catch(controller.report);
    return () => { cancelled = true; void subscription.then((stop) => stop()).catch(controller.report); };
  }, [active, controller]);

  const install = async () => {
    if (!release || busy.current) return;
    busy.current = true;
    setInstalling(true);
    setProgress(null);
    controller.clearError();
    try {
      const installed = await invoke<{ version: string }>("codex_gui_cli_install", { version: release.version });
      setVersion(installed.version);
      await controller.connect();
    } catch (error) { controller.report(error); }
    finally { busy.current = false; setInstalling(false); }
  };
  return { version, release, checking, installing, progress, checked, check, install };
}
