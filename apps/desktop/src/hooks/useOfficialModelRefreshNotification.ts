import { useEffect } from "react";
import { subscribeToOfficialModelRefreshFailures } from "../api/officialModelEvents";
import type { Translate } from "../i18n";

export function useOfficialModelRefreshNotification(notify: (message: string) => void, t: Translate) {
  useEffect(() => subscribeToOfficialModelRefreshFailures(({ usingCachedCatalog }) => {
    notify(t(usingCachedCatalog
      ? "toast.officialModelRefreshFailedWithCache"
      : "toast.officialModelRefreshFailed"));
  }), [notify, t]);
}
