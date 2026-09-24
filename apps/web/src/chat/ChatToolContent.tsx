import { t, useLanguage } from '../i18n';
import { useMemo } from 'react';
import type { Item } from './types';
import { messageSections } from '../../../../shared/chat/messageDetails';
import { toolText } from '../../../../shared/chat/toolText';
import { changedFiles } from '../../../../shared/chat/diff';
import { generatedImageSource } from '../../../../shared/chat/imageSources';
import { collaborationStates, collaborationStatus, collaborationSummary, isCollaborationActivity }
  from '../../../desktop/src/pages/codexGui/collaborationActivity';
import { formatTurnDuration } from './formatters';
import { ChatCodeBlock } from './ChatCodeBlock';
import { ChatMarkdown } from './ChatMarkdown';
import { ChatDiff } from './ChatDiff';
import { ChatToolResult } from './ChatToolResult';
import { ChatImage } from './ChatImage';

const FILE_CHANGE_STATUS: Record<string, string> = {
  declined: '未应用', failed: '修改失败', inProgress: '正在修改',
};

function SearchContent({ item }: { item: Item }) {
  useLanguage();
  return <div className="chat-detail-stack">
    {(item.action?.queries ?? [item.action?.query || item.query]).filter(Boolean).map((query, index) =>
      <p key={index}>{query}</p>)}
    {item.action?.url && /^https?:\/\//i.test(item.action.url) &&
      <a href={item.action.url} target="_blank" rel="noreferrer">{item.action.url}</a>}
    {item.action?.pattern && <p>{t("查找：")}{item.action.pattern}</p>}
    {item.results?.map((result, index) => <article key={index}>
      <a href={/^https?:\/\//i.test(result.url ?? '') ? result.url : undefined}
        target="_blank" rel="noreferrer">{result.title || result.url}</a><p>{result.snippet}</p></article>)}
  </div>;
}

export function ChatToolContent({ item }: { item: Item }) {
  useLanguage();
  const text = toolText(item);
  const files = useMemo(() => item.type === 'fileChange' ? changedFiles(item.changes ?? []) : [], [item]);
  if (['agentMessage', 'reasoning', 'plan', 'enteredReviewMode', 'exitedReviewMode'].includes(item.type)) {
    return <ChatMarkdown text={text} />;
  }
  if (item.type === 'commandExecution') return <>
    <p className="chat-muted">{item.cwd}{item.durationMs != null && ` · ${formatTurnDuration(item.durationMs)}`}</p>
    <ChatCodeBlock text={item.command ?? ''} label={t("命令")} language="bash" copyLabel={t("复制命令")} />
    <ChatCodeBlock text={item.aggregatedOutput || (item.status === 'inProgress' ? t("等待输出…") : t("没有文本输出"))}
      label={t("输出")} copyLabel={t("复制输出")} />
    {item.exitCode != null && <p className={item.exitCode ? 'chat-error' : 'chat-muted'}>{t("退出码：")}{item.exitCode}</p>}
  </>;
  if (item.type === 'fileChange') return <ChatDiff files={files}
    status={FILE_CHANGE_STATUS[item.status ?? '']} />;
  if (['mcpToolCall', 'dynamicToolCall', 'functionCallOutput'].includes(item.type)) return <ChatToolResult item={item} />;
  if (item.type === 'webSearch') return <SearchContent item={item} />;
  if (isCollaborationActivity(item)) return <>
    <p>{collaborationSummary(item, t)}</p>{item.prompt && <ChatMarkdown text={item.prompt} />}
    {item.text && item.text !== item.prompt && <ChatMarkdown text={item.text} />}
    {collaborationStates(item).map((state, index) => <div key={index}>
      <p className="chat-muted">{t("协作任务")} {index + 1} · {t(collaborationStatus(state.status))}</p>
      {state.message && <ChatMarkdown text={state.message} />}</div>)}
  </>;
  if (['imageView', 'imageGeneration'].includes(item.type)) return <>
    <ChatImage source={generatedImageSource(item)} description={item.type === 'imageView' ? t("查看的图片") : t("生成的图片")} />
    <p className="chat-muted">{item.path || item.savedPath}</p>
    {item.failure?.message && <p className="chat-error">{item.failure.message}</p>}
    {item.revisedPrompt && <ChatMarkdown text={item.revisedPrompt} />}
  </>;
  if (item.type === 'contextCompaction') return <p>{t("较早的对话已整理为摘要，可以继续处理当前任务。")}</p>;
  if (item.type === 'sleep') return <p>{t("等待时长：")}{formatTurnDuration(item.durationMs ?? 0)}</p>;
  return <>{messageSections(item).map((section, index) => <ChatCodeBlock key={index}
    text={section.text} label={t(section.title)} copyLabel={t("复制{value1}", { value1: t(section.title) })} />)}</>;
}
