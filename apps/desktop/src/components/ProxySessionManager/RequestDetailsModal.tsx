import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Modal, Table } from "antd";
import { RefreshCw } from "lucide-react";
import { loadProxySessionRequests } from "../../api/backend";
import type { Translate } from "../../i18n";
import type { ProxySession, ProxySessionRequest } from "../../types";
import { ConversationModal } from "./ConversationModal";
import { requestColumns } from "./requestColumns";
import { shortSessionId } from "./sessionCells";
import styles from "./index.module.less";

const REQUEST_DETAIL_DEFAULT_PAGE_SIZE = 50;
const REQUEST_DETAIL_PAGE_SIZE_OPTIONS = [10, 20, 50, 100];
const REQUEST_DETAIL_TABLE_SCROLL_X = 1_150;
const REFRESH_INTERVAL_MS = 2_000;

function useRequestDetails(sessionId: string, t: Translate) {
  const [requestDetails, setRequestDetails] = useState<ProxySessionRequest[]>([]);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState("");
  const refreshingRef = useRef(false);
  const refresh = useCallback(async (showLoading = false) => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    if (showLoading) setDetailsLoading(true);
    try {
      setRequestDetails(await loadProxySessionRequests(sessionId));
      setDetailsError("");
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      setDetailsError(`${t("providers.proxy.sessionsRequestDetailsLoadError")}: ${detail}`);
    } finally {
      refreshingRef.current = false;
      if (showLoading) setDetailsLoading(false);
    }
  }, [sessionId, t]);
  useEffect(() => {
    void refresh(true);
    const timer = window.setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);
  return { requestDetails, detailsLoading, detailsError, refresh };
}

interface RequestDetailsModalProps {
  session: ProxySession;
  onClose: () => void;
  t: Translate;
}

export function RequestDetailsModal({ session, onClose, t }: RequestDetailsModalProps) {
  const { requestDetails, detailsLoading, detailsError, refresh } = useRequestDetails(session.id, t);
  const [conversationRequest, setConversationRequest] = useState<ProxySessionRequest | null>(null);
  const requestDetailColumns = useMemo(() => requestColumns(t, setConversationRequest), [t]);
  return (
    <>
      <Modal
        className={styles.requestModal}
        open
        centered
        width="95vw"
        title={t("providers.proxy.sessionsRequestDetailsTitle", {
          conversation: session.title || shortSessionId(session.id),
        })}
        onCancel={onClose}
        footer={(
          <>
            <Button
              icon={<RefreshCw size={14} />}
              loading={detailsLoading}
              onClick={() => {
                void refresh(true);
              }}
            >
              {t("providers.proxy.sessionsRefresh")}
            </Button>
            <Button type="primary" onClick={onClose}>
              {t("providers.proxy.sessionsClose")}
            </Button>
          </>
        )}
      >
        <p className={styles.description}>
          {t("providers.proxy.sessionsRequestDetailsDescription", {
            count: session.requestCount,
          })}
        </p>
        {detailsError ? <Alert type="error" showIcon message={detailsError} /> : null}
        <Table<ProxySessionRequest>
          className={styles.requestTable}
          rowKey="id"
          size="small"
          loading={detailsLoading}
          columns={requestDetailColumns}
          dataSource={requestDetails}
          pagination={requestDetails.length > 10 ? {
            defaultPageSize: REQUEST_DETAIL_DEFAULT_PAGE_SIZE,
            pageSizeOptions: REQUEST_DETAIL_PAGE_SIZE_OPTIONS,
            showSizeChanger: true,
            size: "small",
          } : false}
          locale={{ emptyText: t("providers.proxy.sessionsRequestDetailsEmpty") }}
          scroll={{ x: REQUEST_DETAIL_TABLE_SCROLL_X, y: "calc(80vh - 260px)" }}
        />
      </Modal>
      {conversationRequest && (
        <ConversationModal key={conversationRequest.id}
          request={requestDetails.find((request) => request.id === conversationRequest.id) ?? conversationRequest}
          onClose={() => setConversationRequest(null)} t={t} />
      )}
    </>
  );
}
