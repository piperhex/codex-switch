import {
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  checkForUpdate,
  downloadAvailableUpdate,
} from "../api/backend";
import type { HelpVersionState } from "../components/modals/HelpModal";
import type { Translate } from "../i18n";
import type { UpdateInfo } from "../types";
import { appUpdateErrorMessage } from "../api/appUpdateErrors";
import { useBackgroundUpdateCheck } from "./useBackgroundUpdateCheck";
import { usePendingAppUpdateInstall } from "./usePendingAppUpdateInstall";
import { useAutoUpdatePreference } from "./useAutoUpdatePreference";
import { useVerifiedAppUpdateInstall } from "./useVerifiedAppUpdateInstall";

export function useAppUpdate(notify: (message: string) => void, t: Translate) {
  const autoUpdate = useAutoUpdatePreference(notify, t);
  const [availableUpdate, setAvailableUpdate] = useState<UpdateInfo | null>(null);
  const [showUpdatePrompt, setShowUpdatePrompt] = useState(false);
  const [checkingForUpdate, setCheckingForUpdate] = useState(false);
  const [downloadingUpdate, setDownloadingUpdate] = useState(false);
  const [updateDownloaded, setUpdateDownloaded] = useState(false);
  const [updateProgress, setUpdateProgress] = useState<number | null>(null);
  const [downloadRequested, setDownloadRequested] = useState(false);
  const [installingUpdate, setInstallingUpdate] = useState(false);
  const [updateInstallError, setUpdateInstallError] = useState<string | null>(null);
  const [helpVersionState, setHelpVersionState] = useState<HelpVersionState>({ status: "checking" });
  usePendingAppUpdateInstall(setInstallingUpdate, setUpdateInstallError, t);
  const helpVersionRequestId = useRef(0);
  const availableUpdateRef = useRef<UpdateInfo | null>(null);
  const downloadingUpdateRef = useRef(false);
  const updateDownloadedRef = useRef(false);
  const userInitiatedDownloadRef = useRef(false);
  const downloadRequestedRef = useRef(false);

  const rememberUpdate = useCallback((update: UpdateInfo) => {
    setAvailableUpdate(update);
    availableUpdateRef.current = update;
  }, []);

  const downloadUpdate = useCallback(async (update: UpdateInfo, promptWhenReady: boolean) => {
    if (promptWhenReady) {
      downloadRequestedRef.current = true;
      userInitiatedDownloadRef.current = true;
      setDownloadRequested(true);
      rememberUpdate(update);
    } else if (!downloadingUpdateRef.current) {
      userInitiatedDownloadRef.current = false;
    }
    downloadingUpdateRef.current = true;
    updateDownloadedRef.current = false;
    setUpdateDownloaded(false);
    setDownloadingUpdate(true);
    setUpdateProgress(null);
    setUpdateInstallError(null);
    try {
      await downloadAvailableUpdate(setUpdateProgress);
      rememberUpdate(update);
      setUpdateDownloaded(true);
      updateDownloadedRef.current = true;
      if (downloadRequestedRef.current) {
        downloadRequestedRef.current = false;
        setDownloadRequested(false);
        setShowUpdatePrompt(true);
      }
      return true;
    } catch (error) {
      userInitiatedDownloadRef.current = false;
      if (downloadRequestedRef.current) {
        downloadRequestedRef.current = false;
        setDownloadRequested(false);
        setUpdateInstallError(appUpdateErrorMessage(error, t));
        setShowUpdatePrompt(true);
      }
      return false;
    } finally {
      downloadingUpdateRef.current = false;
      setDownloadingUpdate(false);
    }
  }, [rememberUpdate, t]);

  const checkForUpdates = useCallback(async () => {
    setCheckingForUpdate(true);
    setUpdateInstallError(null);
    try {
      const update = await checkForUpdate({ force: true });
      if (update) {
        rememberUpdate(update);
        setShowUpdatePrompt(true);
      } else {
        notify(t("update.latest"));
      }
    } catch (error) {
      notify(t("update.checkError", { error: appUpdateErrorMessage(error, t) }));
    } finally {
      setCheckingForUpdate(false);
    }
  }, [notify, rememberUpdate, t]);

  const backgroundUpdateOptions = useMemo(() => ({
    availableUpdateRef,
    downloadUpdate,
    downloadingUpdateRef,
    setUpdateDownloaded,
    updateDownloadedRef,
    userInitiatedDownloadRef,
  }), [downloadUpdate]);
  useBackgroundUpdateCheck(backgroundUpdateOptions);

  const { checkingBeforeInstall, installUpdate } = useVerifiedAppUpdateInstall({
    availableUpdateRef, downloadingUpdateRef, userInitiatedDownloadRef,
    downloadUpdate, setInstallingUpdate, setUpdateInstallError, t,
  });

  const checkAboutVersion = useCallback(() => {
    const requestId = ++helpVersionRequestId.current;
    setHelpVersionState({ status: "checking" });
    void checkForUpdate({ force: true })
      .then((update) => {
        if (helpVersionRequestId.current !== requestId) return;
        if (update) {
          rememberUpdate(update);
          setHelpVersionState({ status: "available", latestVersion: update.latestVersion });
        } else {
          setHelpVersionState({ status: "latest" });
        }
      })
      .catch(() => {
        if (helpVersionRequestId.current === requestId) setHelpVersionState({ status: "error" });
      });
  }, [rememberUpdate]);

  const showAvailableUpdate = useCallback(() => {
    if (!availableUpdateRef.current) return false;
    setUpdateInstallError(null);
    setShowUpdatePrompt(true);
    return true;
  }, []);

  return {
    autoUpdateEnabled: autoUpdate.enabled, setAutoUpdateEnabled: autoUpdate.setEnabled,
    availableUpdate, checkingBeforeInstall, checkingForUpdate, checkAboutVersion, checkForUpdates, downloadingUpdate,
    downloadRequested, downloadUpdate, helpVersionState, installingUpdate, installUpdate,
    setShowUpdatePrompt, showAvailableUpdate, showUpdatePrompt, updateDownloaded,
    updateInstallError, updateProgress,
  };
}
