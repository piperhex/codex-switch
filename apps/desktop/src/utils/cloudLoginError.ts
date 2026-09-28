import type { Translate } from "../i18n";

export function cloudLoginErrorMessage(error: unknown, t: Translate): string {
  const message = error instanceof Error ? error.message : String(error);
  const status = /Cloud login failed with HTTP (\d{3})\b/i.exec(message)?.[1];

  if (status === "429") {
    const minutes = /try again in ([1-9]\d*) minutes?\b/i.exec(message)?.[1];
    return minutes
      ? t("cloudLogin.errorLocked", { minutes })
      : t("cloudLogin.errorRateLimited");
  }

  const invalidCredentials = status === "401" || /invalid email or password/i.test(message);
  const reason = t(invalidCredentials ? "cloudLogin.errorCredentials" : "cloudLogin.errorFailed");
  return `${reason} ${t("cloudLogin.registerHint")}`;
}
