import type { Translate } from "../i18n";

export class AppUpdateCheckTimeoutError extends Error {
  constructor() {
    super("Update check timed out");
    this.name = "AppUpdateCheckTimeoutError";
  }
}

export function appUpdateErrorMessage(error: unknown, t: Translate): string {
  return error instanceof AppUpdateCheckTimeoutError ? t("update.checkTimeout") : String(error);
}
