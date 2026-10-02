import { useProcessingStatus, type ChatProcessingProps } from '../../../../shared/remote-chat/client/useProcessingStatus';
import { useLanguage } from '../i18n';

export function ChatProcessing(props: ChatProcessingProps) {
  useLanguage();
  const { phase, label } = useProcessingStatus(props);
  return <p role="status" data-processing-phase={phase} className="chat-processing chat-processing-status chat-muted">
    <span className="chat-spinner" aria-hidden="true" /><span className="chat-processing-label">{label}</span>
  </p>;
}
