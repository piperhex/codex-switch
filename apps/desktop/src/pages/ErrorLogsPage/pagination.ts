import type { ErrorLogPage } from "../../api/errorLogs";

export const ERROR_LOG_RETENTION_LIMIT = 5_000;
export const LOG_DEFAULT_PAGE_SIZE = 10;
export const LOG_PAGE_SIZE_OPTIONS = [10, 20, 50, 100];
export const EMPTY_LOG_PAGE: ErrorLogPage = {
  entries: [], hasMore: false, total: 0, page: 1, snapshotId: null,
};
