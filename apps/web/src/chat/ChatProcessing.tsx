import type { Turn } from './types';
import { useProcessingSeconds } from '../../../../shared/remote-chat/client/useProcessingSeconds';

export function ChatProcessing({ turn, active }: { turn: Turn; active: boolean }) {
  const seconds = useProcessingSeconds(turn, active);
  return <p role="status" className="chat-processing chat-processing-status chat-muted">
    <span className="chat-spinner" aria-hidden="true" />正在处理 · {seconds}秒
  </p>;
}
