import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { hasLocalBackend, invoke } from "../../api/backend";
import type { Account, Provider } from "../../types";
import { subscribeGuiEvent } from "./webEvents";

export type GuiAccountSelection = { kind: "none" } | { kind: "account" | "provider"; id: string };

export function selectedGuiEntries<T extends { id: string; active: boolean }>(
  entries: T[], selection: GuiAccountSelection, kind: "account" | "provider",
): T[] {
  return entries.map((entry) => ({ ...entry, active: selection.kind === kind && entry.id === selection.id }));
}

export function useGuiAccountSelection(options: { active: boolean; accounts: Account[]; providers: Provider[] }) {
  const [selection, setSelection] = useState<GuiAccountSelection>({ kind: "none" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const switching = useRef(false);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    try {
      const next = await invoke<GuiAccountSelection>("codex_gui_account_selection");
      if (request === generation.current) { setSelection(next); setError(""); }
    } catch {
      if (request === generation.current) setError("暂时无法读取 Codex GUI 账户，请重新打开页面重试。");
    } finally { if (request === generation.current) setLoading(false); }
  }, []);

  useEffect(() => {
    if (!options.active || !hasLocalBackend) return;
    let disposed = false;
    let stop: (() => void) | undefined;
    void subscribeGuiEvent<GuiAccountSelection>("codex-gui-account-changed", (next) => {
      if (disposed) return;
      generation.current++;
      setSelection(next); setLoading(false); setError("");
    }).then((unsubscribe) => {
      if (disposed) { unsubscribe(); return; }
      stop = unsubscribe;
      void refresh();
    }).catch(() => {
      if (!disposed) { setLoading(false); setError("账户更新暂时不可用，请重新打开页面重试。"); }
    });
    return () => { disposed = true; generation.current++; stop?.(); };
  }, [options.active, refresh]);

  const switchSelection = async (next: GuiAccountSelection) => {
    if (switching.current) return false;
    switching.current = true;
    const request = ++generation.current;
    try {
      const saved = await invoke<GuiAccountSelection>("codex_gui_switch_account", { selection: next });
      if (request === generation.current) { setSelection(saved); setError(""); }
      return true;
    } finally { switching.current = false; }
  };
  const accounts = useMemo(() => selectedGuiEntries(options.accounts, selection, "account"),
    [options.accounts, selection]);
  const providers = useMemo(() => selectedGuiEntries(options.providers, selection, "provider"),
    [options.providers, selection]);
  return { accounts, providers, loading, error,
    switchAccount: (id: string) => switchSelection({ kind: "account", id }),
    switchProvider: (id: string) => switchSelection({ kind: "provider", id }) };
}
