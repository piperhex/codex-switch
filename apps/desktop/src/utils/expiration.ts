function displayExpirationDate(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString().slice(0, 10);
}

export function accountExpirationDate(
  manualExpiration?: string | null,
  subscriptionActiveUntil?: string | null,
) {
  const value = manualExpiration?.trim() || subscriptionActiveUntil?.trim();
  return value ? displayExpirationDate(value) : null;
}
