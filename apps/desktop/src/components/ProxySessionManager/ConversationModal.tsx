import { useState, type ReactNode } from "react";
import { Alert, Image, Input, Modal, Tabs } from "antd";
import { Search } from "lucide-react";
import type { Translate } from "../../i18n";
import type { ProxyConversationAttachment, ProxySessionRequest } from "../../types";
import { ConversationAttachment } from "./ConversationAttachment";
import styles from "./conversation.module.less";

interface Props {
  request: ProxySessionRequest;
  onClose: () => void;
  t: Translate;
}

function highlightConversation(value: string, query: string): ReactNode {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) return value;
  const lowerValue = value.toLocaleLowerCase();
  const lowerQuery = normalizedQuery.toLocaleLowerCase();
  const parts: ReactNode[] = [];
  let cursor = 0;
  let matchIndex = lowerValue.indexOf(lowerQuery, cursor);
  while (matchIndex !== -1) {
    if (matchIndex > cursor) parts.push(value.slice(cursor, matchIndex));
    parts.push(
      <mark key={matchIndex} className={styles.searchMatch}>
        {value.slice(matchIndex, matchIndex + normalizedQuery.length)}
      </mark>,
    );
    cursor = matchIndex + normalizedQuery.length;
    matchIndex = lowerValue.indexOf(lowerQuery, cursor);
  }
  if (cursor < value.length) parts.push(value.slice(cursor));
  return parts.length ? parts : value;
}

interface ContentProps {
  text: string;
  attachments?: ProxyConversationAttachment[];
  query: string;
  t: Translate;
}

function ConversationContent({ text, attachments = [], query, t }: ContentProps) {
  return (
    <div className={styles.content}>
      {attachments.length > 0 && (
        <Image.PreviewGroup>
          <div className={styles.attachments}>
            {attachments.map((attachment, index) => (
              <ConversationAttachment key={`${attachment.id}-${index}`}
                attachment={attachment} index={index} t={t} />
            ))}
          </div>
        </Image.PreviewGroup>
      )}
      <pre className={styles.text}>{highlightConversation(text, query)}</pre>
    </div>
  );
}

export function ConversationModal({ request, onClose, t }: Props) {
  const [query, setQuery] = useState("");
  const responseEmpty = request.responseTimeMs == null
    ? t("providers.proxy.conversationResponsePending")
    : t("providers.proxy.conversationResponseEmpty");
  return (
    <Modal open centered width="min(720px, 90vw)" footer={null} onCancel={onClose}
      title={t("providers.proxy.sessionsRequestConversationTitle", { request: `#${request.id}` })}>
      <Input allowClear prefix={<Search size={14} />} value={query}
        aria-label={t("providers.proxy.sessionsRequestConversationSearch")}
        placeholder={t("providers.proxy.sessionsRequestConversationSearch")}
        onChange={(event) => setQuery(event.target.value)} />
      <Tabs size="small" items={[
        {
          key: "input",
          label: t("providers.proxy.conversationInput"),
          children: <ConversationContent
            text={request.conversation || t("providers.proxy.sessionsRequestConversationEmpty")}
            attachments={request.inputAttachments} query={query} t={t} />,
        },
        {
          key: "output",
          label: t("providers.proxy.conversationOutput"),
          children: <>
            {request.responseTruncated && <Alert type="info" showIcon
              message={t("providers.proxy.conversationResponseTruncated")} />}
            <ConversationContent text={request.response || responseEmpty}
              attachments={request.outputAttachments} query={query} t={t} />
          </>,
        },
      ]} />
    </Modal>
  );
}
