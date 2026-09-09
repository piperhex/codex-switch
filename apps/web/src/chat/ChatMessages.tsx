import { useLayoutEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Item, Thread } from './types';

const FOLLOW_DISTANCE = 100;
const toolLabels: Record<string, string> = {
  commandExecution: '执行命令', fileChange: '文件修改', reasoning: '思考过程', webSearch: '搜索网页',
  mcpToolCall: '使用工具', collabAgentToolCall: '协作任务', plan: '执行计划',
};
function content(item: Item) {
  return item.text || (item.content ?? [])
    .map((entry) => typeof entry === 'string' ? entry : entry.text ?? '').join('\n');
}
function ChatMessage({ item }: { item: Item }) {
  if (item.type === 'userMessage') return <div className="chat-user-message">{content(item)}</div>;
  if (item.type === 'agentMessage') return <article className="chat-assistant-message">
    <strong className="chat-speaker">Codex</strong>
    <div className="chat-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{
      a: ({ children, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer">{children}</a>,
      // Remote content is opened deliberately instead of making background requests from the conversation.
      img: ({ src, alt }) => src ? <a href={src} target="_blank" rel="noopener noreferrer">{alt || '查看图片'}</a> : null,
    }}>{content(item)}</ReactMarkdown></div>
  </article>;
  const details = item.aggregatedOutput || item.summary?.join('\n') || content(item)
    || item.changes?.map((change) => `${change.path}\n${change.diff}`).join('\n')
    || (item.output ? JSON.stringify(item.output, null, 2) : '');
  return <details className="chat-tool"><summary>{toolLabels[item.type] ?? '任务活动'}
    {item.status === 'inProgress' ? ' · 进行中' : ''}{item.command && <code>{item.command}</code>}</summary>
    {!!details && <pre>{details}</pre>}
  </details>;
}

export function ChatMessages({ thread }: { thread: Thread | null }) {
  const list = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const items = thread?.turns?.flatMap((turn) => turn.items) ?? [];
  const running = thread?.turns?.some((turn) => turn.status === 'inProgress');
  const lastTurn = thread?.turns?.at(-1);
  useLayoutEffect(() => {
    const follow = () => {
      if (following.current && list.current) list.current.scrollTop = list.current.scrollHeight;
    };
    const observer = new ResizeObserver(follow);
    if (contentRef.current) observer.observe(contentRef.current);
    if (list.current) observer.observe(list.current);
    follow();
    return () => observer.disconnect();
  }, []);
  return <div ref={list} className="chat-scroll chat-messages" aria-label="聊天记录" onScroll={() => {
    const node = list.current;
    if (node) following.current = node.scrollHeight - node.clientHeight - node.scrollTop < FOLLOW_DISTANCE;
  }}><div ref={contentRef} className="chat-message-content">
    {items.map((item) => <ChatMessage key={item.id} item={item} />)}
    {!items.length && <div className="chat-empty"><span className="chat-empty-glyph">✳</span>
      <h2>想一起完成什么？</h2><p className="chat-muted">消息会发送到你的电脑，随时可以接着聊。</p></div>}
    {running && <p role="status" className="chat-muted">Codex 正在处理…</p>}
    {lastTurn?.error && <p role="alert" className="chat-error">{lastTurn.error.message}</p>}
  </div></div>;
}
