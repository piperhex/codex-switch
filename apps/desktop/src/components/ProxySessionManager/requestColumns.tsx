import { Button, Tag, type TableColumnsType } from "antd";
import { Eye } from "lucide-react";
import type { Translate } from "../../i18n";
import type { ProxySessionRequest } from "../../types";
import { formatResponseTime, RequestSpeed, RequestTokenUsage } from "./sessionCells";
import styles from "./index.module.less";

interface RequestCellProps { request: ProxySessionRequest; t: Translate }

function FirstResponseTime({ request, t }: RequestCellProps) {
  if (request.firstResponseTimeMs != null) return <strong>{formatResponseTime(request.firstResponseTimeMs)}</strong>;
  if (request.responseTimeMs != null || request.interrupted) return <span className={styles.muted}>—</span>;
  return <Tag color="processing">
    {t("providers.proxy.sessionsRequestAwaitingFirstResponse", {
      time: formatResponseTime(Math.max(0, Date.now() - request.startedAt * 1_000)),
    })}
  </Tag>;
}

function ResponseTime({ request, t }: RequestCellProps) {
  if (request.interrupted) return <Tag>{t("providers.proxy.sessionsRequestInterrupted")}</Tag>;
  const time = formatResponseTime(request.responseTimeMs ?? Math.max(0, Date.now() - request.startedAt * 1_000));
  return request.responseTimeMs == null
    ? <Tag color="processing">{t("providers.proxy.sessionsRequestInProgress", { time })}</Tag>
    : <strong>{t("providers.proxy.sessionsRequestResponded", { time })}</strong>;
}

export function requestColumns(t: Translate, onOpenConversation: (request: ProxySessionRequest) => void)
  : TableColumnsType<ProxySessionRequest> {
  const unknown = <span className={styles.muted}>{t("providers.proxy.sessionsRequestUnknown")}</span>;
  return [
    {
      title: t("providers.proxy.sessionsRequestNumber"), dataIndex: "id", key: "id", width: 80,
      render: (id: number) => <strong>#{id}</strong>,
    },
    {
      title: t("providers.proxy.sessionsRequestStartedAt"), dataIndex: "startedAt", key: "startedAt", width: 150,
      render: (value: number) => <span title={new Date(value * 1000).toLocaleString()}>
        {new Date(value * 1000).toLocaleTimeString()}</span>,
    },
    {
      title: t("providers.proxy.sessionsRequestModel"), dataIndex: "model", key: "model", ellipsis: true,
      render: (model?: string | null) => model || unknown,
    },
    {
      title: t("providers.proxy.sessionsRequestSpeed"), dataIndex: "serviceTier", key: "serviceTier", width: 110,
      render: (serviceTier?: ProxySessionRequest["serviceTier"]) => <RequestSpeed serviceTier={serviceTier} t={t} />,
    },
    {
      title: t("providers.proxy.sessionsRequestReasoning"),
      dataIndex: "reasoningEffort", key: "reasoningEffort", width: 120,
      render: (effort?: string | null) => effort ? <Tag>{effort}</Tag> : unknown,
    },
    {
      title: t("providers.proxy.sessionsRequestFirstResponseTime"),
      key: "firstResponseTimeMs", width: 130, align: "right",
      render: (_, request) => <FirstResponseTime request={request} t={t} />,
    },
    {
      title: t("providers.proxy.sessionsRequestResponseTime"), key: "responseTimeMs", width: 120, align: "right",
      render: (_, request) => <ResponseTime request={request} t={t} />,
    },
    {
      title: t("providers.proxy.sessionsRequestTokens"), key: "tokens", width: 110, align: "right",
      render: (_, request) => <RequestTokenUsage request={request} t={t} />,
    },
    {
      title: t("providers.proxy.sessionsRequestConversation"), key: "conversation", width: 110, align: "center",
      render: (_, request) => <Button type="link" size="small" className={styles.requestConversationButton}
        icon={<Eye size={13} />} onClick={() => onOpenConversation(request)}>
        {t("providers.proxy.sessionsRequestViewConversation")}</Button>,
    },
  ];
}
