import type { KatexOptions } from 'katex';

export const mathOptions: KatexOptions = {
  throwOnError: false, strict: 'ignore', trust: false, maxExpand: 1000, maxSize: 20,
};

/** Convert TeX delimiters before Markdown consumes their backslashes; leave code examples intact. */
export function normalizeMathDelimiters(text: string): string {
  const protectedCode = new RegExp(
    '(^[ \\t]*(?:>[ \\t]*)*(?:[-+*] |\\d+[.)] )?)(`{3,}|~{3,})[^\\n]*(?:\\n|$)'
      + '|(`+)|\\\\[\\\\()[\\]]|^(?: {4}|\\t)[^\\n]*(?:\\n|$)', 'gm');
  let result = '';
  let cursor = 0;
  const unclosed = new Set<string>();
  const findCodeEnd = codeEndFinder(text);
  let match: RegExpExecArray | null;
  while ((match = protectedCode.exec(text))) {
    const start = match.index;
    const marker = match[2] || match[3];
    let end = protectedCode.lastIndex;
    let replacement = match[0];
    if (marker) {
      end = findCodeEnd(end, marker, Boolean(match[2]));
      replacement = text.slice(start, end);
    } else if (match[0] === '\\(' || match[0] === '\\[') {
      const close = match[0] === '\\(' ? '\\)' : '\\]';
      // A missing closer cannot appear later in this immutable string. Do not rescan its suffix.
      const closeAt = unclosed.has(close) ? -1 : text.indexOf(close, end);
      if (closeAt < 0) unclosed.add(close);
      if (closeAt >= 0) {
        const body = text.slice(end, closeAt);
        const display = close === '\\]';
        replacement = display ? `\n\n$$\n${body.trim()}\n$$\n\n` : `$${body}$`;
        end = closeAt + close.length;
      }
    }
    result += text.slice(cursor, start) + replacement;
    cursor = end;
    protectedCode.lastIndex = end;
  }
  return result + text.slice(cursor);
}

function codeEndFinder(text: string) {
  let inlineEnds: Map<number, number> | undefined;
  return (start: number, marker: string, block: boolean): number => {
    if (!block) {
      inlineEnds ??= inlineCodeEnds(text);
      return inlineEnds.get(start) ?? start;
    }
    const closing = new RegExp(`^[ \\t]*(?:>[ \\t]*)*${marker[0]}{${marker.length},}[ \\t]*\\r?$`, 'gm');
    closing.lastIndex = start;
    return closing.exec(text) ? closing.lastIndex : text.length;
  };
}

/** Index equal-length backtick runs once, including unmatched runs in streamed messages. */
function inlineCodeEnds(text: string): Map<number, number> {
  const ends = new Map<number, number>();
  const previous = new Map<number, number>();
  for (const match of text.matchAll(/`+/g)) {
    const length = match[0].length;
    const end = match.index + length;
    const start = previous.get(length);
    if (start !== undefined) ends.set(start, end);
    previous.set(length, end);
  }
  return ends;
}
