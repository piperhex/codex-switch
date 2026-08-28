import type { Language } from "../../i18n";
import type { CodexThreadEntry } from "../../types";

export interface ThreadGroup {
  cwd: string;
  items: CodexThreadEntry[];
  updatedAt: number;
}

export const UNKNOWN_WORKSPACE = "未知工作目录";
const RECENT_SESSION_WORKSPACE_PATTERN = /(?:^|[\\/])Codex[\\/]\d{4}-\d{2}-\d{2}(?:[\\/]|$)/i;

export function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

export function formatTokenAmount(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(2)}K`;
  return value.toLocaleString();
}

export function relativeTime(timestamp: number | null, language: Language) {
  if (!timestamp) return "—";
  const seconds = Math.max(0, Math.floor(Date.now() / 1000 - timestamp));
  if (seconds < 3600) {
    const minutes = Math.max(1, Math.floor(seconds / 60));
    return language === "zh" ? `${minutes} 分钟` : `${minutes} min`;
  }
  if (seconds < 86400) {
    const hours = Math.floor(seconds / 3600);
    return language === "zh" ? `${hours} 小时` : `${hours} hr`;
  }
  if (seconds < 604800) {
    const days = Math.floor(seconds / 86400);
    return language === "zh" ? `${days} 天` : `${days} days`;
  }
  const weeks = Math.floor(seconds / 604800);
  return language === "zh" ? `${weeks} 周` : `${weeks} wk`;
}

export function groupLabel(cwd: string) {
  const normalized = cwd.replace(/\\/g, "/").replace(/\/$/, "");
  const pathSegments = normalized.split("/").filter(Boolean);
  return pathSegments[pathSegments.length - 1] || cwd;
}

export function isUnassignedWorkspace(cwd: string) {
  return cwd === UNKNOWN_WORKSPACE || RECENT_SESSION_WORKSPACE_PATTERN.test(cwd);
}

export function workspaceDisplayName(group: ThreadGroup, untitled: string) {
  const titles = group.items
    .map((item) => item.title.trim())
    .filter(Boolean);
  if (isUnassignedWorkspace(group.cwd)) return titles.join("、") || untitled;
  return groupLabel(group.cwd);
}

export function interpolate(value: string, values: Record<string, string | number>) {
  return Object.entries(values).reduce(
    (text, [key, replacement]) => text.replace(`{${key}}`, String(replacement)),
    value,
  );
}

export function groupThreads(threads: CodexThreadEntry[]): ThreadGroup[] {
  const grouped = new Map<string, CodexThreadEntry[]>();
  for (const item of threads) grouped.set(item.cwd, [...(grouped.get(item.cwd) ?? []), item]);
  return [...grouped.entries()]
    .map(([cwd, items]) => ({
      cwd,
      items: items.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)),
      updatedAt: Math.max(...items.map((item) => item.updatedAt ?? 0)),
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}
