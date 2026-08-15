import { useEffect, type Dispatch, type SetStateAction } from "react";
import {
  hasPendingAppUpdateInstall,
  installPendingAppUpdateOnLaunch,
} from "../api/backend";

export function usePendingAppUpdateInstall(
  setInstalling: Dispatch<SetStateAction<boolean>>,
  setInstallError: Dispatch<SetStateAction<string | null>>,
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
        setInstallError(String(error));
        setInstalling(false);
      });
    return () => {
      active = false;
    };
  }, [setInstallError, setInstalling]);
}
