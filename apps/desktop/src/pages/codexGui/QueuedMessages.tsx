import { Button, Dropdown } from "antd";
import { ArrowDown, ArrowUp, CornerDownRight, MoreHorizontal, Trash2 } from "lucide-react";
import type { QueuedMessage } from "./types";
import type { MessageQueue } from "./messageQueue";
import styles from "./QueuedMessages.module.less";

interface QueueProps {
  threadId: string;
  messages: QueuedMessage[];
  running: boolean;
  connected: boolean;
  queue: MessageQueue;
  editDisabled: boolean;
  onEdit: (id: string) => void;
}

interface QueueItemProps {
  item: QueuedMessage;
  context: Omit<QueueProps, "messages">;
  canMoveUp: boolean;
  canMoveDown: boolean;
}

function QueueItem({ item, context, canMoveUp, canMoveDown }: QueueItemProps) {
  const { threadId, queue, running, connected, editDisabled, onEdit } = context;
  return <li className={styles.item}>
    <div className={styles.row}>
      <CornerDownRight size={15} />
      <span className={styles.text}>{item.text || item.attachments?.map((item) => item.name).join("、") || "图片消息"}
        {item.images.length > 0 && <small> · {item.images.length} 张图片</small>}
        {Boolean(item.attachments?.length) && <small> · {item.attachments?.length} 个附件</small>}</span>
      <Button type="text" size="small" aria-label="上移待发送消息" title="上移" icon={<ArrowUp size={14} />}
        disabled={!canMoveUp} onClick={() => queue.move(threadId, item.id, "up")} />
      <Button type="text" size="small" aria-label="下移待发送消息" title="下移" icon={<ArrowDown size={14} />}
        disabled={!canMoveDown} onClick={() => queue.move(threadId, item.id, "down")} />
      <Button type="text" size="small" disabled={!running || !connected || item.busy}
        onClick={() => void queue.steer(threadId, item.id)}>调整方向</Button>
      <Button type="text" size="small" aria-label="删除待发送消息" icon={<Trash2 size={14} />}
        disabled={item.busy} onClick={() => queue.remove(threadId, item.id)} />
      <Dropdown trigger={["click"]} menu={{ items: [{ key: "edit", label: "编辑" }],
        onClick: () => onEdit(item.id) }} overlayStyle={{ maxWidth: 400 }}>
        <Button type="text" size="small" aria-label="待发送消息选项" icon={<MoreHorizontal size={16} />}
          disabled={item.busy || editDisabled} />
      </Dropdown>
    </div>
  </li>;
}

export function QueuedMessages({ messages, ...context }: QueueProps) {
  if (!messages.length) return null;
  return <div className={`${styles.queue} ${context.running ? styles.attached : ""}`}>
    <div className={styles.heading}>待发送 · {messages.length}
      {!context.running && <Button type="text" size="small"
        disabled={!context.connected || messages.some((item) => item.busy)}
        onClick={() => void context.queue.flush(context.threadId)}>发送全部</Button>}</div>
    <ul aria-label="待发送消息">{messages.map((item, index) =>
      <QueueItem key={item.id} item={item} context={context}
        canMoveUp={!item.busy && index > 0 && !messages[index - 1].busy}
        canMoveDown={!item.busy && index < messages.length - 1 && !messages[index + 1].busy} />)}</ul>
  </div>;
}
