import { memo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Item } from './types';
import type { ChatMessagesProps } from '../../../../shared/remote-chat/client/messageProps';
import { useHistoryScroll } from './useHistoryScroll';
import { ChatImage } from './ChatImage';
import { itemImageSources, isInlineImage, localImageSource } from '../../../../shared/chat/imageSources';

const toolLabels: Record<string, string> = {
  commandExecution: '执行命令', fileChange: '文件修改', reasoning: '思考过程', webSearch: '搜索网页',
  mcpToolCall: '使用工具', collabAgentToolCall: '协作任务', plan: '执行计划',
};
// Stable renderers keep an open image viewer mounted while history or live text updates.
const markdownComponents: Components = {
  a: ({ children, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer">{children}</a>,
  img: ({ src, alt }) => <ChatImage source={src} description={alt || '图片'} />,
};
function content(item: Item) {
  return item.text || (item.content ?? [])
    .map((entry) => typeof entry === 'string' ? entry : entry.text ?? '').join('\n');
}
const ChatMessage = memo(function ChatMessage({ item }: { item: Item }) {
  const images = itemImageSources(item);
  if (item.type === 'userMessage') return <div className="chat-user-message">{content(item)}
    {images.map((source, index) => <ChatImage key={index} source={source} />)}</div>;
  if (images.length) return <div>{images.map((source, index) => <ChatImage key={index} source={source} />)}</div>;
  if (item.type === 'agentMessage') return <article className="chat-assistant-message">
    <strong className="chat-speaker">Codex</strong>
    <div className="chat-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={(url, key) => {
      if (/^https?:\/\//i.test(url)) return url;
      return key === 'src' && (isInlineImage(url) || localImageSource(url)) ? url : '';
    }} components={markdownComponents}>{content(item)}</ReactMarkdown></div>
  </article>;
  const details = item.aggregatedOutput || item.summary?.join('\n') || content(item)
    || item.changes?.map((change) => `${change.path}\n${change.diff}`).join('\n')
    || (item.output ? JSON.stringify(item.output, null, 2) : '');
  return <details className="chat-tool"><summary>{toolLabels[item.type] ?? '任务活动'}
    {item.status === 'inProgress' ? ' · 进行中' : ''}{item.command && <code>{item.command}</code>}</summary>
    {!!details && <pre>{details}</pre>}
  </details>;
});

export function ChatMessages(props: ChatMessagesProps) {
  const { thread, loading, loadingMore, hasMore } = props;
  const scroll = useHistoryScroll(props);
  const items = thread?.turns?.flatMap((turn) => turn.items) ?? [];
  const lastTurn = thread?.turns?.at(-1);
  return <div ref={scroll.list} className="chat-scroll chat-messages" aria-label="聊天记录" onScroll={scroll.onScroll}>
    <div ref={scroll.content} className="chat-message-content">
    {(hasMore || (loading && !items.length)) && <div className="chat-history-more">
      {loadingMore || (loading && !items.length)
        ? <span role="status" className="chat-processing"><span className="chat-spinner" aria-hidden="true" />
          正在加载聊天记录…</span>
        : <button type="button" className="chat-button" onClick={scroll.more}>加载更早的消息</button>}
    </div>}
    {items.map((item) => <div key={item.id} data-message-id={item.id}><ChatMessage item={item} /></div>)}
    {!items.length && !loading && <div className="chat-empty"><span className="chat-empty-glyph">✳</span>
      <h2>想一起完成什么？</h2><p className="chat-muted">消息会发送到你的电脑，随时可以接着聊。</p></div>}
    {lastTurn?.error && <p role="alert" className="chat-error">{lastTurn.error.message}</p>}
  </div></div>;
}
