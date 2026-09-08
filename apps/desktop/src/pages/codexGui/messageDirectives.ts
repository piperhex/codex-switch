export interface ReviewComment { title: string; body: string; file: string; start?: number; end?: number }
export type MessageSection = { type: "markdown"; text: string } | { type: "review"; comment: ReviewComment };

function parseComment(line: string): ReviewComment | null {
  const match = line.match(/^::code-comment\{(.+)\}\s*$/);
  if (!match) return null;
  const attributes = Object.fromEntries([...match[1].matchAll(/(\w+)="((?:\\.|[^"\\])*)"/g)]
    .map((entry) => [entry[1], entry[2].replace(/\\(["\\])/g, "$1")]));
  if (!attributes.title || !attributes.body || !attributes.file) return null;
  const positiveInteger = (value?: string) => value && /^\d+$/.test(value)
    && Number.isSafeInteger(Number(value)) && Number(value) > 0
    ? Number(value) : undefined;
  return { title: attributes.title, body: attributes.body, file: attributes.file,
    start: positiveInteger(attributes.start), end: positiveInteger(attributes.end) };
}

/** Directives inside fenced code remain examples, never interactive review comments. */
export function messageSections(text: string): MessageSection[] {
  const sections: MessageSection[] = [];
  let markdown: string[] = [];
  let fence: string | undefined;
  const flush = () => {
    if (markdown.length) sections.push({ type: "markdown", text: markdown.join("\n") });
    markdown = [];
  };
  for (const line of text.split("\n")) {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/)?.[1];
    if (marker && (!fence || (marker[0] === fence[0] && marker.length >= fence.length))) {
      fence = fence ? undefined : marker;
      markdown.push(line);
      continue;
    }
    const comment = fence ? null : parseComment(line);
    if (comment) { flush(); sections.push({ type: "review", comment }); }
    else markdown.push(line);
  }
  flush();
  return sections;
}
