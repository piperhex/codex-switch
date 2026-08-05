const HTTP_STATUS_PATTERN = /\bHTTP\s+[1-5]\d{2}\b/i;

const NETWORK_ERROR_FRAGMENTS = [
  "error sending request",
  "failed to send request",
  "network",
  "timed out",
  "timeout",
  "connection",
  "dns",
  "tcp",
  "tls",
  "请求超时",
  "连接失败",
  "网络错误",
] as const;

export function isUsageNetworkError(error: string): boolean {
  if (HTTP_STATUS_PATTERN.test(error)) return false;
  const normalized = error.toLowerCase();
  return NETWORK_ERROR_FRAGMENTS.some((fragment) => normalized.includes(fragment));
}

export function shouldShowUsageError(error: string | null | undefined, showNetworkErrors: boolean): boolean {
  return Boolean(error && (showNetworkErrors || !isUsageNetworkError(error)));
}
