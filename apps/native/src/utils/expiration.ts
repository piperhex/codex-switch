function expirationTimestamp(value?: string | null) {
  if (!value?.trim()) return null;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function displayExpirationDate(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString().slice(0, 10);
}

export function earliestExpirationDate(
  manualExpiration?: string | null,
  apiExpiration?: string | null,
) {
  const candidates = [manualExpiration, apiExpiration]
    .flatMap((value) => {
      const normalized = value?.trim();
      const timestamp = expirationTimestamp(normalized);
      return normalized && timestamp !== null ? [{ value: normalized, timestamp }] : [];
    })
    .sort((left, right) => left.timestamp - right.timestamp);

  if (candidates[0]) return displayExpirationDate(candidates[0].value);
  const fallback = manualExpiration?.trim() || apiExpiration?.trim();
  return fallback ? displayExpirationDate(fallback) : null;
}
