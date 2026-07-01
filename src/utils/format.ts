export function initials(email: string) {
  return email.split("@")[0].slice(0, 2).toUpperCase();
}

export function remainingTone(value: number) {
  if (value <= 15) return "danger";
  if (value <= 35) return "warning";
  return "good";
}

export function resetLabel(timestamp?: number | null) {
  if (!timestamp) return "重置时间未知";
  const distance = Math.max(0, timestamp * 1000 - Date.now());
  const minutes = Math.ceil(distance / 60_000);
  if (minutes < 60) return `${minutes} 分钟后重置`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) return `${hours} 小时${rest ? ` ${rest} 分` : ""}后重置`;
  return `${Math.floor(hours / 24)} 天 ${hours % 24} 小时后重置`;
}

export function formatUpdated(timestamp?: string | null) {
  if (!timestamp) return "尚未刷新";
  const value = new Date(timestamp);
  if (Number.isNaN(value.getTime())) return "时间未知";
  return value.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatRefreshTime(timestamp?: string | null) {
  if (!timestamp) return "暂无";
  return new Date(timestamp).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function formatBeijingTime(timestamp?: string | null) {
  if (!timestamp) return "时间未知";
  const value = new Date(timestamp);
  if (Number.isNaN(value.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(value);
}
