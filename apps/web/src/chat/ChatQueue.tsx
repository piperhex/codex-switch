import { CornerDownRight, Trash2 } from 'lucide-react';
import type { QueueProps } from '../../../../shared/remote-chat/client/queueProps';
import './queue.css';

export function ChatQueue({ messages, running, disabled, act }: QueueProps) {
  if (!messages.length) return null;
  const sending = messages.some((message) => message.busy);
  return <section className="chat-queue" aria-label="待发送消息">
    <div className="chat-queue-heading"><span>待发送 · {messages.length}</span>
      {!running && <button type="button" disabled={disabled || sending}
        onClick={() => void act('queueFlush')}>发送全部</button>}</div>
    <ul>{messages.map((message) => <li key={message.id}>
      <CornerDownRight size={15} aria-hidden="true" />
      <div className="chat-queue-content"><p>{message.text || '图片消息'}</p>
        {message.imageCount > 0 && <small>{message.imageCount} 张图片 </small>}
        {message.attachmentCount > 0 && <small>{message.attachmentCount} 个附件</small>}
        {message.busy && <small role="status">正在发送…</small>}
        {message.error && <small role="alert" className="chat-queue-error">{message.error}</small>}
      </div>
      <button type="button" disabled={disabled || sending} onPointerDown={(event) => event.preventDefault()}
        onClick={() => void act('queueSendNow', message.id)}>立即发送</button>
      <button type="button" aria-label="删除待发送消息" disabled={disabled || message.busy}
        onPointerDown={(event) => event.preventDefault()} onClick={() => void act('queueRemove', message.id)}>
        <Trash2 size={16} aria-hidden="true" /></button>
    </li>)}</ul>
  </section>;
}
