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
  let match: RegExpExecArray | null;
  while ((match = protectedCode.exec(text))) {
    const start = match.index;
    const marker = match[2] || match[3];
    let end = protectedCode.lastIndex;
    let replacement = match[0];
    if (marker) {
      end = codeEnd(text, end, marker, Boolean(match[2]));
      replacement = text.slice(start, end);
    } else if (match[0] === '\\(' || match[0] === '\\[') {
      const close = match[0] === '\\(' ? '\\)' : '\\]';
      const closeAt = text.indexOf(close, end);
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

function codeEnd(text: string, start: number, marker: string, block: boolean): number {
  const closing = block
    ? new RegExp(`^[ \\t]*(?:>[ \\t]*)*${marker[0]}{${marker.length},}[ \\t]*\\r?$`, 'gm')
    : new RegExp('`+', 'g');
  closing.lastIndex = start;
  let match: RegExpExecArray | null;
  while ((match = closing.exec(text))) {
    if (block || match[0].length === marker.length) return closing.lastIndex;
  }
  return block ? text.length : start;
}
