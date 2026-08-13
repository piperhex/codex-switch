import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { checkForUpdate } from "../api/backend";
import type { UpdateInfo } from "../types";

const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

interface BackgroundUpdateOptions {
  availableUpdateRef: MutableRefObject<UpdateInfo | null>;
  downloadUpdate: (update: UpdateInfo, promptWhenReady: boolean) => Promise<boolean>;
  downloadingUpdateRef: MutableRefObject<boolean>;
  setUpdateDownloaded: Dispatch<SetStateAction<boolean>>;
  updateDownloadedRef: MutableRefObject<boolean>;
  userInitiatedDownloadRef: MutableRefObject<boolean>;
}

export function useBackgroundUpdateCheck(options: BackgroundUpdateOptions) {
  useEffect(() => {
    let cancelled = false;
    const checkAndDownload = async () => {
      try {
        if (options.downloadingUpdateRef.current || options.userInitiatedDownloadRef.current) return;
        const replacePending = options.updateDownloadedRef.current;
        const previousVersion = options.availableUpdateRef.current?.latestVersion;
        const update = await checkForUpdate({ force: true, replacePending });
        if (!update || (replacePending && update.latestVersion === previousVersion)) return;
        if (replacePending) {
          options.updateDownloadedRef.current = false;
          options.setUpdateDownloaded(false);
        }
        if (!cancelled) await options.downloadUpdate(update, false);
      } catch {
        // Background update checks retry quietly on the next interval.
      }
    };
    void checkAndDownload();
    const timer = window.setInterval(() => void checkAndDownload(), UPDATE_CHECK_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [options]);
}
