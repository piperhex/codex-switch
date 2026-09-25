import { t, useLanguage } from '../i18n';
import { memo } from 'react';
import { Quote } from 'lucide-react';
import type { Item } from './types';
import { itemImageSources } from '../../../../shared/chat/imageSources';
import { quotedMessage } from '../../../../shared/chat/quotedMessage';
import { questionMessageText } from '../../../../shared/remote-chat/client/asyncQuestions';
import { ChatActivity } from './ChatActivity';
import { ChatMarkdown } from './ChatMarkdown';
import { ChatImage } from './ChatImage';
import { ChatCopyButton } from './ChatCopyButton';
import { ChatQuoteButton } from './ChatQuotes';

export const ChatMessage = memo(function ChatMessage({ item, onOpen, process = false, running = false, onQuote,
  desktop = false, onInspect }: {
  item: Item; onOpen: (id: string) => void; process?: boolean; running?: boolean; onQuote?: () => void;
  desktop?: boolean; onInspect?: () => void;
}) {
  useLanguage();
  const text = questionMessageText(item);
  if (!['userMessage', 'agentMessage'].includes(item.type)) {
    return <ChatActivity item={item} onOpen={onOpen} running={running && item.status === 'inProgress'}
      inline={desktop} onInspect={onInspect} />;
  }
  const user = item.type === 'userMessage';
  const content = quotedMessage(text);
  const images = itemImageSources(item);
  return <article className={user ? 'chat-user-message-wrap' : 'chat-assistant-message'}
    data-quote-source={desktop && !user ? item.id : undefined}>
    {user && desktop && images.length > 0 && <div className="chat-sent-images">
      {images.map((source, index) => <ChatImage key={index} source={source} />)}
    </div>}
    {user ? (!desktop || content.text || content.quotes.length > 0) && <div className="chat-user-message">
      {content.quotes.map((quote, index) => <details className="chat-message-quote" key={index}>
        <summary><Quote size={14} /><span>{quote}</span></summary><blockquote>{quote}</blockquote>
      </details>)}
      {content.text && <ChatMarkdown text={content.text} desktop={desktop} />}
      {!desktop && images.map((source, index) => <ChatImage key={index} source={source} />)}
    </div> : <ChatMarkdown text={text} process={process} desktop={desktop} />}
    {!!text.trim() && !running && !(desktop && process) && <div className="chat-message-actions" data-quote-exclude>
      <ChatCopyButton text={text} label={user ? t("复制消息") : t("复制回复")} />
      <ChatQuoteButton messageId={item.id} text={text} role={user ? 'user' : 'assistant'} onQuote={onQuote} />
    </div>}
  </article>;
});
