import type { Content, Item } from '../../apps/desktop/src/pages/codexGui/types';

const CONTEXT_START = '<codex_gui_conversation_context>';
const CONTEXT_END = '</codex_gui_conversation_context>';
const REFERENCE_PREFIX = 'codex-thread://';

function closingTag(text: string, start: number): number {
  let quoted = false;
  let escaped = false;
  for (let index = start; index < text.length; index++) {
    const character = text[index];
    if (escaped) escaped = false;
    else if (quoted && character === '\\') escaped = true;
    else if (character === '"') quoted = !quoted;
    else if (!quoted && text.startsWith(CONTEXT_END, index)) return index;
  }
  return -1;
}

function reference(payload: string): Content[] {
  try {
    const data: unknown = JSON.parse(payload);
    if (!data || typeof data !== 'object') return [];
    const value = data as Record<string, unknown>;
    if (value.kind !== 'reference' || typeof value.id !== 'string' || typeof value.name !== 'string'
      || !value.id || value.id.length > 200 || /[/\\\x00-\x1f\x7f]/u.test(value.id)) return [];
    return [{ type: 'mention', name: value.name, path: `${REFERENCE_PREFIX}${value.id}` }];
  } catch { return []; }
}

/** The reserved envelope is model context, including when old history joins it to user text. */
function visibleText(source: string): Content[] {
  const references: Content[] = [];
  let visible = '';
  let cursor = 0;
  let start = source.indexOf(CONTEXT_START);
  while (start !== -1) {
    visible += source.slice(cursor, start);
    const payloadStart = start + CONTEXT_START.length;
    const end = closingTag(source, payloadStart);
    if (end === -1) { cursor = source.length; break; }
    references.push(...reference(source.slice(payloadStart, end)));
    cursor = end + CONTEXT_END.length;
    start = source.indexOf(CONTEXT_START, cursor);
  }
  visible += source.slice(cursor);
  return [...(visible.trim() ? [{ type: 'text', text: visible.trimEnd() }] : []), ...references];
}

export function visibleUserContent(content: readonly (Content | string)[] = []): Content[] {
  return content.flatMap((part) => {
    const value = typeof part === 'string' ? { type: 'text', text: part } : part;
    return value.type === 'text' && value.text?.includes(CONTEXT_START) ? visibleText(value.text) : [value];
  });
}

/** Preserve referential identity for the ordinary streaming path and non-user activities. */
export function visibleUserMessage(item: Item): Item {
  if (item.type !== 'userMessage' || !item.content?.some((part) =>
    (typeof part === 'string' ? part : part.text)?.includes(CONTEXT_START))) return item;
  return { ...item, content: visibleUserContent(item.content) };
}
