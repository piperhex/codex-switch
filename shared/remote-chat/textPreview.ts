export interface TextPreview {
  path: string;
  text: string;
}

export function isMarkdownPath(path: string): boolean {
  return /\.(md|markdown)$/i.test(path);
}
