import { useEffect, type Dispatch, type SetStateAction } from "react";
import { appUpdateErrorMessage } from "../api/appUpdateErrors";
import type { Translate } from "../i18n";
import {
  hasPendingAppUpdateInstall,
  installPendingAppUpdateOnLaunch,
} from "../api/backend";

export function usePendingAppUpdateInstall(
  setInstalling: Dispatch<SetStateAction<boolean>>,
  setInstallError: Dispatch<SetStateAction<string | null>>,
  t: Translate,
) {
  useEffect(() => {
    if (!hasPendingAppUpdateInstall()) return undefined;

    let active = true;
    setInstalling(true);
    setInstallError(null);
    void installPendingAppUpdateOnLaunch()
      .then(() => {
        if (active) setInstalling(false);
      })
      .catch((error) => {
        if (!active) return;
        setInstallError(appUpdateErrorMessage(error, t));
        setInstalling(false);
      });
    return () => {
      active = false;
    };
  }, [setInstallError, setInstalling, t]);
}
