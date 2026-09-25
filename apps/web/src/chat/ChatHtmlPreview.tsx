import { useState } from 'react';
import { t } from '../i18n';
import { ChatCodeBlock } from './ChatCodeBlock';
import { ChatCopyButton } from './ChatCopyButton';
import './markdownPreview.css';

export function isHtmlPath(path: string) { return /\.html?$/i.test(path); }

export function ChatHtmlPreview({ text }: { text: string }) {
  const [source, setSource] = useState(false);
  return <section className="chat-html-preview">
    <div className="chat-markdown-preview-toolbar">
      <div className="chat-markdown-preview-modes" role="group" aria-label={t('显示方式')}>
        <button type="button" aria-pressed={!source} onClick={() => setSource(false)}>{t('预览')}</button>
        <button type="button" aria-pressed={source} onClick={() => setSource(true)}>{t('源码')}</button>
      </div>
      <ChatCopyButton text={text} label={t('复制文件内容')} />
    </div>
    {source ? <ChatCodeBlock text={text} language="html" label="HTML" copyLabel={t('复制文件内容')} />
      : <iframe title={t('HTML 预览')} srcDoc={text} sandbox="allow-scripts" referrerPolicy="no-referrer"
        className="chat-html-frame" />}
  </section>;
}
