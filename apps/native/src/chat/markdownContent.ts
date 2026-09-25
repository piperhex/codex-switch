import { messageSections, type ReviewComment } from '../../../desktop/src/pages/codexGui/messageDirectives';
import { parseFileReference } from '../../../../shared/chat/fileReference';
import { parseMarkdown, type MarkdownNode } from './markdownTree';

export type MarkdownContent = { type: 'block'; node: MarkdownNode } | { type: 'review'; comment: ReviewComment };

/** Share desktop directive parsing so fenced examples and partial streamed comments remain Markdown. */
export function markdownContent(text: string, user = false): MarkdownContent[] {
  if (user) return parseMarkdown(text, true).map(node => ({ type: 'block', node }));
  return messageSections(text).flatMap<MarkdownContent>((section) => section.type === 'review'
    ? [section] : parseMarkdown(section.text).map((node) => ({ type: 'block', node })));
}

export function reviewLocation(comment: ReviewComment) {
  const location = comment.start ? `${comment.file}:${comment.start}` : comment.file;
  const end = comment.end && comment.start && comment.end > comment.start ? `–${comment.end}` : '';
  return { reference: parseFileReference(location),
    label: `${comment.file}${comment.start ? ` · 第 ${comment.start}${end} 行` : ''}` };
}
