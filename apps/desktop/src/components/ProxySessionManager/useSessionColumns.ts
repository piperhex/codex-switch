import { useMemo, useState } from "react";
import type { TableProps } from "antd";
import type { Translate } from "../../i18n";
import type { ProxySession } from "../../types";
import { sessionColumns, type ActivityFilter } from "./sessionColumns";

type ProxySessionColumnKey =
  | "conversation"
  | "connection"
  | "target"
  | "context"
  | "tokens"
  | "activity";

const ACTIVITY_FILTER_STORAGE_KEY = "codex-switch.proxy-session-activity-filter";
const HIDDEN_COLUMNS_STORAGE_KEY = "codex-switch:proxy-session-hidden-columns";
const COLUMN_ORDER_STORAGE_KEY = "codex-switch:proxy-session-column-order";
const PROXY_SESSION_COLUMN_KEYS: ProxySessionColumnKey[] = [
  "conversation",
  "connection",
  "target",
  "context",
  "tokens",
  "activity",
];
const REORDERABLE_COLUMN_KEYS = PROXY_SESSION_COLUMN_KEYS.filter(
  (key): key is Exclude<ProxySessionColumnKey, "activity"> => key !== "activity",
);
type ReorderableColumnKey = typeof REORDERABLE_COLUMN_KEYS[number];

function isProxySessionColumnKey(value: unknown): value is ProxySessionColumnKey {
  return typeof value === "string"
    && PROXY_SESSION_COLUMN_KEYS.includes(value as ProxySessionColumnKey);
}

function loadHiddenColumns(): ProxySessionColumnKey[] {
  try {
    const parsed: unknown = JSON.parse(
      window.localStorage.getItem(HIDDEN_COLUMNS_STORAGE_KEY) ?? "[]",
    );
    if (!Array.isArray(parsed)) return [];
    const hiddenColumns = parsed.filter(isProxySessionColumnKey);
    return hiddenColumns.length < PROXY_SESSION_COLUMN_KEYS.length ? hiddenColumns : [];
  } catch {
    return [];
  }
}

function persistHiddenColumns(columns: ProxySessionColumnKey[]) {
  try {
    window.localStorage.setItem(HIDDEN_COLUMNS_STORAGE_KEY, JSON.stringify(columns));
  } catch {
    // Keep the in-memory selection when local storage is unavailable.
  }
}

export function isReorderableColumnKey(value: unknown): value is ReorderableColumnKey {
  return isProxySessionColumnKey(value) && value !== "activity";
}

function loadColumnOrder(): ReorderableColumnKey[] {
  try {
    const parsed: unknown = JSON.parse(
      window.localStorage.getItem(COLUMN_ORDER_STORAGE_KEY) ?? "[]",
    );
    const stored = Array.isArray(parsed)
      ? [...new Set(parsed.filter(isReorderableColumnKey))]
      : [];
    return [
      ...stored,
      ...REORDERABLE_COLUMN_KEYS.filter((key) => !stored.includes(key)),
    ];
  } catch {
    return [...REORDERABLE_COLUMN_KEYS];
  }
}

function persistColumnOrder(columns: ReorderableColumnKey[]) {
  try {
    window.localStorage.setItem(COLUMN_ORDER_STORAGE_KEY, JSON.stringify(columns));
  } catch {
    // Keep the in-memory order when local storage is unavailable.
  }
}

function loadActivityFilter(): ActivityFilter[] {
  try {
    const stored = window.localStorage.getItem(ACTIVITY_FILTER_STORAGE_KEY);
    if (stored === "all") return [];
    if (stored === "active" || stored === "idle") return [stored];
  } catch {
    // Fall back to the default when local storage is unavailable.
  }
  return [];
}

export function useSessionColumns(t: Translate, openRequestDetails: (session: ProxySession) => void) {
  const [activityFilter, setActivityFilter] = useState<ActivityFilter[]>(loadActivityFilter);
  const [hiddenColumns, setHiddenColumns] = useState<ProxySessionColumnKey[]>(loadHiddenColumns);
  const [columnOrder, setColumnOrder] = useState<ReorderableColumnKey[]>(loadColumnOrder);
  const columns = useMemo(() => sessionColumns({ activityFilter, openRequestDetails, t }),
    [activityFilter, openRequestDetails, t]);
  const hiddenColumnSet = useMemo(() => new Set(hiddenColumns), [hiddenColumns]);
  const columnLabels = useMemo<Record<ProxySessionColumnKey, string>>(() => ({
    conversation: t("providers.proxy.sessionsConversation"),
    connection: t("providers.proxy.sessionsConnection"),
    target: t("providers.proxy.sessionsTarget"),
    context: t("providers.proxy.sessionsContext"),
    tokens: t("providers.proxy.sessionsTokens"),
    activity: t("providers.proxy.sessionsActivity"),
  }), [t]);
  const orderedColumns = useMemo(() => {
    const columnsByKey = new Map(
      columns
        .filter((column) => isProxySessionColumnKey(column.key))
        .map((column) => [column.key as ProxySessionColumnKey, column]),
    );
    return [...columnOrder, "activity" as const]
      .map((key) => columnsByKey.get(key))
      .filter((column): column is NonNullable<typeof column> => column != null);
  }, [columnOrder, columns]);
  const visibleColumns = useMemo(
    () => orderedColumns.filter(
      (column) => !isProxySessionColumnKey(column.key) || !hiddenColumnSet.has(column.key),
    ),
    [hiddenColumnSet, orderedColumns],
  );
  const columnSettings = useMemo<{ key: ProxySessionColumnKey; label: string }[]>(
    () => [...columnOrder, "activity" as const].map((key) => ({
      key,
      label: columnLabels[key],
    })),
    [columnLabels, columnOrder],
  );
  const visibleColumnCount = columnSettings.filter(
    ({ key }) => !hiddenColumnSet.has(key),
  ).length;

  const setColumnVisible = (key: ProxySessionColumnKey, visible: boolean) => {
    setHiddenColumns((current) => {
      if (!visible && !current.includes(key) && visibleColumnCount <= 1) return current;
      const next = visible
        ? current.filter((column) => column !== key)
        : [...new Set([...current, key])];
      persistHiddenColumns(next);
      return next;
    });
  };

  const reorderColumn = (
    source: ReorderableColumnKey,
    target: ReorderableColumnKey,
  ) => {
    if (source === target) return;
    setColumnOrder((current) => {
      const next = current.filter((key) => key !== source);
      next.splice(current.indexOf(target), 0, source);
      persistColumnOrder(next);
      return next;
    });
  };

  const moveColumn = (key: ReorderableColumnKey, offset: number) => {
    setColumnOrder((current) => {
      const sourceIndex = current.indexOf(key);
      const targetIndex = Math.max(0, Math.min(current.length - 1, sourceIndex + offset));
      if (sourceIndex === targetIndex) return current;
      const next = [...current];
      next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, key);
      persistColumnOrder(next);
      return next;
    });
  };

  const handleTableChange: TableProps<ProxySession>["onChange"] = (_, filters) => {
    const nextFilter = (filters.activity || []).filter(
      (value): value is ActivityFilter => value === "active" || value === "idle",
    );
    setActivityFilter(nextFilter);
    try {
      window.localStorage.setItem(
        ACTIVITY_FILTER_STORAGE_KEY,
        nextFilter[0] || "all",
      );
    } catch {
      // Keep the in-memory selection when local storage is unavailable.
    }
  };

  return { visibleColumns, columnSettings, hiddenColumnSet, visibleColumnCount,
    setColumnVisible, reorderColumn, moveColumn, handleTableChange };
}
