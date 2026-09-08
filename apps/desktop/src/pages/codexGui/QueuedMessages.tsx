import { useState } from "react";
import { Button, Dropdown, Input } from "antd";
import { CornerDownRight, MoreHorizontal, Trash2 } from "lucide-react";
import type { QueuedMessage } from "./types";
import type { MessageQueue } from "./messageQueue";
import styles from "./QueuedMessages.module.less";

interface QueueProps {
  threadId: string;
  messages: QueuedMessage[];
  running: boolean;
  connected: boolean;
  queue: MessageQueue;
}

function QueueItem({ item, context }: { item: QueuedMessage; context: Omit<QueueProps, "messages"> }) {
  const [text, setText] = useState(item.text);
  const { threadId, queue, running, connected } = context;
  const edit = (editing: boolean, value?: string) => queue.edit(threadId, item.id,
    value == null ? { editing } : { editing, text: value });
  return <li className={styles.item}>
    <div className={styles.row}>
      <CornerDownRight size={15} />
      <span className={styles.text}>{item.text || "图片消息"}
        {item.images.length > 0 && <small> · {item.images.length} 张图片</small>}</span>
      <Button type="text" size="small" disabled={!running || !connected || item.busy || item.editing}
        onClick={() => void queue.steer(threadId, item.id)}>调整方向</Button>
      <Button type="text" size="small" aria-label="删除待发送消息" icon={<Trash2 size={14} />}
        disabled={item.busy} onClick={() => queue.remove(threadId, item.id)} />
      <Dropdown trigger={["click"]} menu={{ items: [{ key: "edit", label: "编辑" }], onClick: () => {
        setText(item.text); edit(true);
      } }} overlayStyle={{ maxWidth: 400 }}>
        <Button type="text" size="small" aria-label="待发送消息选项" icon={<MoreHorizontal size={16} />}
          disabled={item.busy || item.editing} />
      </Dropdown>
    </div>
    {item.editing && <div className={styles.editor}>
      <Input.TextArea aria-label="编辑待发送消息" value={text} autoSize={{ minRows: 2, maxRows: 6 }}
        onChange={(event) => setText(event.target.value)} />
      <div><Button size="small" onClick={() => edit(false)}>取消</Button>
        <Button size="small" type="primary" disabled={!text.trim() && !item.images.length}
          onClick={() => edit(false, text)}>保存</Button></div>
    </div>}
  </li>;
}

export function QueuedMessages({ messages, ...context }: QueueProps) {
  if (!messages.length) return null;
  return <div className={styles.queue}>
    <div className={styles.heading}>待发送 · {messages.length}
      {!context.running && <Button type="text" size="small"
        disabled={!context.connected || messages.some((item) => item.editing || item.busy)}
        onClick={() => void context.queue.flush(context.threadId)}>发送全部</Button>}</div>
    <ul aria-label="待发送消息">{messages.map((item) =>
      <QueueItem key={item.id} item={item} context={context} />)}</ul>
  </div>;
}
