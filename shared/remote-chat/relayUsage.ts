export interface RelayUsage {
  monthUsedBytes: number;
  monthlyLimitBytes: number;
  resetAt: string;
}

export const RELAY_QUOTA_MESSAGE = '本月转发流量已达上限，可使用 P2P 直连，或联系管理员调整额度。';

export function parseRelayUsage(value: unknown): RelayUsage | undefined {
  if (!value || typeof value !== 'object') return;
  const data = value as Record<string, unknown>;
  if (!Number.isSafeInteger(data.monthUsedBytes) || Number(data.monthUsedBytes) < 0
    || !Number.isSafeInteger(data.monthlyLimitBytes) || Number(data.monthlyLimitBytes) < -1
    || typeof data.resetAt !== 'string' || !Number.isFinite(Date.parse(data.resetAt))) return;
  return data as unknown as RelayUsage;
}

/** Preserve rejection of a frame larger than the remaining quota until the allowance changes. */
export class RelayQuota {
  usage?: RelayUsage;
  blocked = false;
  reason = 'quota';

  receive(message: Record<string, unknown>): boolean {
    if (message.type === 'relay-quota') {
      this.blocked = true;
      this.reason = message.reason === 'unavailable' ? 'unavailable' : 'quota';
      return true;
    }
    if (message.type !== 'relay-usage') return false;
    const usage = parseRelayUsage(message.usage);
    if (!usage) return false;
    const changed = !this.usage || usage.monthUsedBytes !== this.usage.monthUsedBytes
      || usage.monthlyLimitBytes !== this.usage.monthlyLimitBytes || usage.resetAt !== this.usage.resetAt;
    if (!changed && this.reason !== 'unavailable') return false;
    this.usage = usage;
    this.blocked = usage.monthlyLimitBytes !== -1 && usage.monthUsedBytes >= usage.monthlyLimitBytes;
    this.reason = 'quota';
    return true;
  }
}

export function formatRelayBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const index = Math.min(Math.floor(Math.log(Math.max(1, bytes)) / Math.log(1024)), units.length - 1);
  return `${new Intl.NumberFormat('zh-CN', { maximumFractionDigits: index ? 2 : 0 })
    .format(bytes / 1024 ** index)} ${units[index]}`;
}
