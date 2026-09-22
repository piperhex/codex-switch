import { useState } from 'react';
import { t, useLanguage } from '../i18n';
import { ChatCodeBlock } from './ChatCodeBlock';
import { ChatCopyButton } from './ChatCopyButton';
import { ChatMarkdown } from './ChatMarkdown';
import './markdownPreview.css';

export function ChatMarkdownPreview({ text }: { text: string }) {
  useLanguage();
  const [source, setSource] = useState(false);
  return <section className="chat-markdown-preview">
    <div className="chat-markdown-preview-toolbar">
      <div className="chat-markdown-preview-modes" role="group" aria-label={t('显示方式')}>
        <button type="button" aria-pressed={!source} onClick={() => setSource(false)}>{t('预览')}</button>
        <button type="button" aria-pressed={source} onClick={() => setSource(true)}>{t('原文')}</button>
      </div>
      <ChatCopyButton text={text} label={t('复制原文')} />
    </div>
    {source && <ChatCodeBlock text={text} language="markdown" label={t('原文')} copyLabel={t('复制原文')} />}
    {!source && (text.trim() ? <ChatMarkdown text={text} /> : <p className="chat-muted">{t('（空文件）')}</p>)}
  </section>;
}
