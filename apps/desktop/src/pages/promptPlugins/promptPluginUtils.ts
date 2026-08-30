export function isPromptPluginUpdateAvailable(
  installedVersion: string | null | undefined,
  marketVersion: string,
) {
  return Boolean(installedVersion && marketVersion && installedVersion !== marketVersion);
}

export function nextPromptPluginVersion(version: string | null | undefined) {
  const normalized = version?.trim().replace(/^v/i, "") ?? "";
  const match = normalized.match(/^(\d+)\.(\d+)\.(\d+)$/);
  return match ? `${match[1]}.${match[2]}.${Number(match[3]) + 1}` : (version ?? "1.0.0");
}
