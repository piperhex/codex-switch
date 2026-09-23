import { useCallback, useRef, useState, type MutableRefObject } from "react";
import { checkForUpdate, installDownloadedUpdate } from "../api/backend";
import { appUpdateErrorMessage } from "../api/appUpdateErrors";
import type { Translate } from "../i18n";
import type { UpdateInfo } from "../types";

interface VerifiedInstallOptions {
  availableUpdateRef: MutableRefObject<UpdateInfo | null>;
  downloadingUpdateRef: MutableRefObject<boolean>;
  userInitiatedDownloadRef: MutableRefObject<boolean>;
  downloadUpdate: (update: UpdateInfo, promptWhenReady: boolean) => Promise<boolean>;
  setInstallingUpdate: (installing: boolean) => void;
  setUpdateInstallError: (error: string | null) => void;
  t: Translate;
}

export function useVerifiedAppUpdateInstall(options: VerifiedInstallOptions) {
  const [checkingBeforeInstall, setCheckingBeforeInstall] = useState(false);
  const busy = useRef(false);
  const {
    availableUpdateRef, downloadingUpdateRef, userInitiatedDownloadRef,
    downloadUpdate, setInstallingUpdate, setUpdateInstallError, t,
  } = options;

  const installUpdate = useCallback(async () => {
    if (busy.current || downloadingUpdateRef.current) return;
    busy.current = true;
    userInitiatedDownloadRef.current = true;
    setCheckingBeforeInstall(true);
    setUpdateInstallError(null);
    try {
      const downloadedVersion = availableUpdateRef.current?.latestVersion;
      const update = await checkForUpdate({ force: true, replacePending: true });
      setCheckingBeforeInstall(false);
      if (update && update.latestVersion !== downloadedVersion) {
        await downloadUpdate(update, true);
        return;
      }
      setInstallingUpdate(true);
      await installDownloadedUpdate();
    } catch (error) {
      setUpdateInstallError(appUpdateErrorMessage(error, t));
      setInstallingUpdate(false);
    } finally {
      setCheckingBeforeInstall(false);
      busy.current = false;
    }
  }, [availableUpdateRef, downloadingUpdateRef, userInitiatedDownloadRef,
    downloadUpdate, setInstallingUpdate, setUpdateInstallError, t]);

  return { checkingBeforeInstall, installUpdate };
}
