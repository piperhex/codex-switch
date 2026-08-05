import { useCallback, useEffect, useState } from "react";
import {
  activateProvider,
  copyLocalProxyLanApiKey,
  loadLocalProxyStatus,
  loadProviders,
  queryProviderBalance,
  removeProvider,
  saveProviderProfile,
  setLocalProxyAutoDisableUnreachable,
  setLocalProxyCustomPriority,
  setLocalProxyImageAccount,
  setLocalProxyOpenaiAuthAccount,
  setLocalProxyListenOnAllInterfaces,
  setLocalProxyAutoSwitch,
  setProviderModelControl,
  startLocalProxy,
  stopLocalProxy,
  subscribeToLocalProxyStartProgress,
  subscribeToLocalProxyStopProgress,
  subscribeToProviderEvents,
  switchProviderModel,
} from "../api/backend";
import type { Translate } from "../i18n";
import type {
  LocalProxyStartProgress,
  LocalProxyStatus,
  LocalProxyStopProgress,
  Provider,
  ProviderInput,
} from "../types";

interface ProviderCloudSync {
  pushProvider?: (id: string) => Promise<void> | void;
  deleteProvider?: (id: string) => Promise<void> | void;
}

function providerErrorMessage(error: unknown, t: Translate) {
  const message = String(error);
  if (message.includes("conversation history could not be synchronized")
    && message.includes("ChatGPT/Codex could not be restarted")) {
    return t("providers.error.proxyStartSyncAndRestartFailed");
  }
  if (message.includes("Local proxy was started, but conversation history could not be synchronized")) {
    return t("providers.error.proxyStartSyncFailed");
  }
  if (message.includes("Local proxy was started and conversation history was synchronized")) {
    return t("providers.error.proxyStartedRestartFailed");
  }
  if (message.includes("Proxy stop was cancelled because conversation history could not be restored safely")) {
    return t("providers.error.proxyStopCancelled");
  }
  if (message.includes("Proxy stop failed and automatic recovery was incomplete")) {
    return t("providers.error.proxyStopRecoveryIncomplete");
  }
  if (message.includes("Local proxy was stopped, the selected auth.json and non-proxy conversations were restored")) {
    return t("providers.error.proxyStoppedRestartFailed");
  }
  if (message.includes("API key is required for a new provider")) return t("providers.error.apiKeyRequired");
  if (message.includes("Provider does not exist")) return t("providers.error.notFound");
  if (message.includes("Chat Completions providers need a local Responses bridge")) {
    return t("providers.error.chatBridgeRequired");
  }
  if (message.includes("Provider API key is empty")) return t("providers.error.apiKeyEmpty");
  if (message.includes("Provider name is required")) return t("providers.error.nameRequired");
  if (message.includes("Model is required")) return t("providers.error.modelRequired");
  if (message.includes("Base URL is required")) return t("providers.error.baseUrlRequired");
  if (message.includes("Base URL must be an http:// or https:// URL with a host")) {
    return t("providers.error.baseUrlHttp");
  }
  if (message.includes("Provider Base URL must be an upstream API endpoint")) {
    return t("providers.error.baseUrlLocalProxy");
  }
  if (message.includes("Official Codex local proxy requires")) return t("providers.error.officialProxyAuthRequired");
  if (message.includes("Provider id is invalid")) return t("providers.error.providerIdInvalid");
  if (message.includes("Provider balance query token is required")) {
    return t("providers.error.balanceTokenRequired");
  }
  if (message.includes("Provider balance query URL is required")) {
    return t("providers.error.balanceUrlRequired");
  }
  if (message.includes("Provider balance query URL must be an http:// or https:// URL with a host")) {
    return t("providers.error.balanceUrlHttp");
  }
  if (message.startsWith("Provider balance query URL is invalid:")) {
    return t("providers.error.balanceUrlInvalid", {
      error: message.slice("Provider balance query URL is invalid:".length).trim(),
    });
  }
  if (message.includes("New API wallet username and password must be provided together")) {
    return t("providers.error.walletLoginRequired");
  }
  if (message.includes("New API wallet password is required when changing the username")) {
    return t("providers.error.walletPasswordRequired");
  }
  if (message.includes("Image generation account must use an OAuth token")) {
    return t("providers.error.imageAccountOAuthRequired");
  }
  if (message.includes("Start the local proxy before selecting an image generation account")) {
    return t("providers.error.imageAccountProxyRequired");
  }
  if (message.includes("OpenAI login account must use an OAuth token")) {
    return t("providers.error.openaiAuthAccountOAuthRequired");
  }
  if (message.includes("Start the local proxy before selecting an OpenAI login account")) {
    return t("providers.error.openaiAuthAccountProxyRequired");
  }
  if (message.includes("API key is required before listening on the local network")) {
    return t("providers.error.lanApiKeyRequired");
  }
  if (message.startsWith("Base URL is invalid:")) {
    return t("providers.error.baseUrlInvalid", { error: message.slice("Base URL is invalid:".length).trim() });
  }
  return message;
}

export function useProviderManager(
  notify: (message: string) => void,
  t: Translate,
  cloudSync?: ProviderCloudSync,
) {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [localProxy, setLocalProxy] = useState<LocalProxyStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyProviderId, setBusyProviderId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [proxyBusy, setProxyBusy] = useState(false);
  const [proxyStartProgress, setProxyStartProgress] = useState<LocalProxyStartProgress | null>(null);
  const [proxyStopProgress, setProxyStopProgress] = useState<LocalProxyStopProgress | null>(null);

  const load = useCallback(async () => {
    try {
      const [nextProviders, nextProxy] = await Promise.all([
        loadProviders(),
        loadLocalProxyStatus(),
      ]);
      setProviders(nextProviders);
      setLocalProxy(nextProxy);
    } catch (error) {
      notify(String(error));
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => subscribeToProviderEvents(() => void load()), [load]);

  const saveProvider = useCallback(async (provider: ProviderInput) => {
    setSaving(true);
    try {
      const saved = await saveProviderProfile(provider);
      notify(t("toast.providerSaved"));
      await load();
      await cloudSync?.pushProvider?.(saved.id);
      return saved;
    } catch (error) {
      notify(providerErrorMessage(error, t));
      return null;
    } finally {
      setSaving(false);
    }
  }, [cloudSync, load, notify, t]);

  const switchProvider = useCallback(async (id: string) => {
    setBusyProviderId(id);
    try {
      const hotSwitch = Boolean(localProxy?.running);
      const refreshesBalance = providers.some(
        (provider) => provider.id === id && Boolean(provider.balancePlatform),
      );
      await activateProvider(id);
      notify(t(hotSwitch ? "toast.providerSwitchedHot" : "toast.providerSwitched"));
      await Promise.all([
        load(),
        refreshesBalance
          ? queryProviderBalance(id).catch(() => undefined)
          : Promise.resolve(),
      ]);
    } catch (error) {
      notify(providerErrorMessage(error, t));
    } finally {
      setBusyProviderId(null);
    }
  }, [load, localProxy?.running, notify, providers, t]);

  const switchModel = useCallback(async (id: string, model: string) => {
    setBusyProviderId(id);
    try {
      await switchProviderModel(id, model);
      notify(t("toast.providerModelSwitched"));
      await load();
      await cloudSync?.pushProvider?.(id);
    } catch (error) {
      notify(providerErrorMessage(error, t));
    } finally {
      setBusyProviderId(null);
    }
  }, [cloudSync, load, notify, t]);

  const setModelControl = useCallback(async (id: string, controlledByCodex: boolean) => {
    setBusyProviderId(id);
    try {
      await setProviderModelControl(id, controlledByCodex);
      notify(t("toast.providerModelControlSaved"));
      await load();
      await cloudSync?.pushProvider?.(id);
    } catch (error) {
      notify(providerErrorMessage(error, t));
    } finally {
      setBusyProviderId(null);
    }
  }, [cloudSync, load, notify, t]);

  const deleteProvider = useCallback(async (id: string) => {
    setBusyProviderId(id);
    try {
      await removeProvider(id);
      notify(t("toast.providerDeleted"));
      await load();
      await cloudSync?.deleteProvider?.(id);
    } catch (error) {
      notify(providerErrorMessage(error, t));
    } finally {
      setBusyProviderId(null);
    }
  }, [cloudSync, load, notify, t]);

  const startProxy = useCallback(async () => {
    setProxyBusy(true);
    setProxyStartProgress({ phase: "preparingClient", percent: 3 });
    const unsubscribeProgress = subscribeToLocalProxyStartProgress((progress) => {
      setProxyStartProgress(progress);
    });
    const fakeProgressTimer = window.setInterval(() => {
      setProxyStartProgress((current) => {
        if (!current || current.phase === "complete" || current.phase === "failed") return current;
        const ceiling = current.phase === "preparingClient" ? 12
          : current.phase === "startingProxy" ? 35
            : current.phase === "syncingConversations" ? 88
              : 98;
        if (current.percent >= ceiling) return current;
        return { ...current, percent: Math.min(ceiling, current.percent + 1) };
      });
    }, 700);
    try {
      setLocalProxy(await startLocalProxy());
      setProxyStartProgress({ phase: "complete", percent: 100 });
      notify(t("toast.localProxyStarted"));
      await load();
      await new Promise((resolve) => window.setTimeout(resolve, 650));
    } catch (error) {
      const startCompleted = String(error).includes(
        "Local proxy was started and conversation history was synchronized",
      );
      setProxyStartProgress((current) => ({
        phase: startCompleted ? "complete" : "failed",
        percent: startCompleted ? 100 : Math.max(current?.percent ?? 0, 3),
      }));
      notify(providerErrorMessage(error, t));
      // Configuration is kept when only the client relaunch fails, so ensure the
      // card reflects the running proxy before the user starts it manually.
      await load();
      await new Promise((resolve) => window.setTimeout(resolve, 1_000));
    } finally {
      window.clearInterval(fakeProgressTimer);
      unsubscribeProgress();
      setProxyStartProgress(null);
      setProxyBusy(false);
    }
  }, [load, notify, t]);

  const stopProxy = useCallback(async () => {
    setProxyBusy(true);
    setProxyStopProgress({ phase: "stoppingClient", percent: 3 });
    const unsubscribeProgress = subscribeToLocalProxyStopProgress((progress) => {
      setProxyStopProgress(progress);
    });
    const fakeProgressTimer = window.setInterval(() => {
      setProxyStopProgress((current) => {
        if (!current || current.phase === "complete" || current.phase === "failed") return current;
        const ceiling = current.phase === "stoppingClient" ? 10
          : current.phase === "restoringConversations" ? 88
            : current.phase === "restoringConfiguration" ? 94
              : 98;
        if (current.percent >= ceiling) return current;
        return { ...current, percent: Math.min(ceiling, current.percent + 1) };
      });
    }, 700);
    try {
      setLocalProxy(await stopLocalProxy());
      setProxyStopProgress({ phase: "complete", percent: 100 });
      notify(t("toast.localProxyStopped"));
      await load();
      await new Promise((resolve) => window.setTimeout(resolve, 650));
    } catch (error) {
      const stopCompleted = String(error).includes(
        "Local proxy was stopped, the selected auth.json and non-proxy conversations were restored",
      );
      setProxyStopProgress((current) => ({
        phase: stopCompleted ? "complete" : "failed",
        percent: stopCompleted ? 100 : Math.max(current?.percent ?? 0, 3),
      }));
      notify(providerErrorMessage(error, t));
      await load();
      await new Promise((resolve) => window.setTimeout(resolve, 1_000));
    } finally {
      window.clearInterval(fakeProgressTimer);
      unsubscribeProgress();
      setProxyStopProgress(null);
      setProxyBusy(false);
    }
  }, [load, notify, t]);

  const setProxyAutoSwitch = useCallback(async (enabled: boolean) => {
    setProxyBusy(true);
    try {
      setLocalProxy(await setLocalProxyAutoSwitch(enabled));
      notify(t(enabled ? "toast.proxyAutoSwitchEnabled" : "toast.proxyAutoSwitchDisabled"));
      await load();
    } catch (error) {
      notify(providerErrorMessage(error, t));
    } finally {
      setProxyBusy(false);
    }
  }, [load, notify, t]);

  const setProxyAutoDisableUnreachable = useCallback(async (enabled: boolean) => {
    setProxyBusy(true);
    try {
      setLocalProxy(await setLocalProxyAutoDisableUnreachable(enabled));
      await load();
    } catch (error) {
      notify(providerErrorMessage(error, t));
    } finally {
      setProxyBusy(false);
    }
  }, [load, notify, t]);

  const setProxyCustomPriority = useCallback(async (enabled: boolean) => {
    setProxyBusy(true);
    try {
      setLocalProxy(await setLocalProxyCustomPriority(enabled));
      await load();
    } catch (error) {
      notify(providerErrorMessage(error, t));
    } finally {
      setProxyBusy(false);
    }
  }, [load, notify, t]);

  const setProxyImageAccount = useCallback(async (accountId: string | null) => {
    setProxyBusy(true);
    try {
      setLocalProxy(await setLocalProxyImageAccount(accountId));
      notify(t("toast.proxyImageAccountSaved"));
      await load();
    } catch (error) {
      notify(providerErrorMessage(error, t));
    } finally {
      setProxyBusy(false);
    }
  }, [load, notify, t]);

  const setProxyOpenaiAuthAccount = useCallback(async (accountId: string | null) => {
    setProxyBusy(true);
    try {
      setLocalProxy(await setLocalProxyOpenaiAuthAccount(accountId));
      notify(t(accountId
        ? "toast.proxyOpenaiAuthAccountSaved"
        : "toast.proxyOpenaiAuthAccountCleared"));
      await load();
    } catch (error) {
      notify(providerErrorMessage(error, t));
      await load();
    } finally {
      setProxyBusy(false);
    }
  }, [load, notify, t]);

  const setProxyListenOnAllInterfaces = useCallback(async (enabled: boolean, apiKey?: string) => {
    setProxyBusy(true);
    try {
      setLocalProxy(await setLocalProxyListenOnAllInterfaces(enabled, apiKey));
      notify(t(enabled ? "toast.proxyLanListeningEnabled" : "toast.proxyLanListeningDisabled"));
      await load();
      return true;
    } catch (error) {
      notify(providerErrorMessage(error, t));
      await load();
      return false;
    } finally {
      setProxyBusy(false);
    }
  }, [load, notify, t]);

  const copyProxyLanApiKey = useCallback(async () => {
    try {
      await copyLocalProxyLanApiKey();
      notify(t("toast.proxyLanApiKeyCopied"));
    } catch (error) {
      notify(String(error).includes("Local network API key is not configured")
        ? t("providers.error.lanApiKeyRequired")
        : String(error));
    }
  }, [notify, t]);

  return {
    providers,
    localProxy,
    loading,
    busyProviderId,
    saving,
    proxyBusy,
    proxyStartProgress,
    proxyStopProgress,
    activeProvider: providers.find((provider) => provider.active) ?? null,
    saveProvider,
    switchProvider,
    switchModel,
    setModelControl,
    deleteProvider,
    startProxy,
    stopProxy,
    setProxyAutoSwitch,
    setProxyAutoDisableUnreachable,
    setProxyCustomPriority,
    setProxyImageAccount,
    setProxyOpenaiAuthAccount,
    setProxyListenOnAllInterfaces,
    copyProxyLanApiKey,
    reload: load,
  };
}
