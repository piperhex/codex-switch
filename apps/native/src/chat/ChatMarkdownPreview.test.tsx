import * as React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { isMarkdownPath } from '../../../../shared/remote-chat/textPreview';
import { ChatMarkdownPreview } from './ChatMarkdownPreview';

const state = vi.hoisted(() => ({ mode: 'preview' }));
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof React>(),
  useState: () => [state.mode, (mode: string) => { state.mode = mode; }],
}));
vi.mock('react-native', () => ({ Pressable: 'Button', Text: 'Text', View: 'View',
  StyleSheet: { create: <T,>(styles: T) => styles },
}));
vi.mock('../components/SheetScrollView', () => ({ SheetScrollView: 'ScrollView', SheetInset: 'Inset' }));
vi.mock('./ChatCodeBlock', () => ({ ChatCodeBlock: 'Code' }));
vi.mock('./Markdown', () => ({ ChatMarkdown: 'Markdown' }));
vi.mock('./CopyTextButton', () => ({ CopyTextButton: 'Copy' }));

type NodeProps = { children?: React.ReactNode; onPress: () => void; [key: string]: unknown };
function descendants(value: unknown): React.ReactElement<NodeProps>[] {
  if (Array.isArray(value)) return value.flatMap(descendants);
  if (!React.isValidElement<NodeProps>(value)) return [];
  return [value, ...descendants(value.props.children)];
}
const text = '# 检查结果\n\n| 项目 | 状态 |\n| --- | --- |\n| 渲染 | 完成 |\n\n'
  + '- **完整内容**\n'.repeat(2000) + '\n最后一行\n';
function render(value = text) { return descendants(ChatMarkdownPreview({ text: value, line: 3 })); }
function select(label: string) {
  render().find(node => node.type === 'Button' && descendants(node.props.children)
    .some(child => child.props.children === label))!.props.onPress();
}

beforeEach(() => { vi.stubGlobal('React', React); state.mode = 'preview'; });
afterEach(() => vi.unstubAllGlobals());

it('recognizes Markdown extensions without rendering ordinary source files', () => {
  for (const path of ['./verification.md', 'C:\\docs\\README.MD', '/docs/说明.markdown']) {
    expect(isMarkdownPath(path)).toBe(true);
  }
  for (const path of ['source.ts', 'report.md.txt', 'page.mdx']) expect(isMarkdownPath(path)).toBe(false);
});

it('defaults to rendered content and switches to the unchanged source and back', () => {
  expect(render().find(node => node.type === 'Markdown')?.props.text).toBe(text);
  expect(render().some(node => node.type === 'Code')).toBe(false);
  select('原文');
  expect(render().some(node => node.type === 'Markdown')).toBe(false);
  expect(render().find(node => node.type === 'Code')?.props).toMatchObject({ text, lineNumbers: true });
  select('预览');
  expect(render().find(node => node.type === 'Markdown')?.props.text).toBe(text);
});

it('keeps a labeled copy action outside the scroll area with all source text in both modes', () => {
  for (const mode of ['预览', '原文']) {
    select(mode);
    const nodes = render();
    expect(nodes.find(node => node.type === 'Copy')?.props).toMatchObject({
      text, label: '复制原文', variant: 'labeled',
    });
    expect(descendants(nodes.find(node => node.type === 'ScrollView'))
      .some(node => node.type === 'Copy')).toBe(false);
  }
});

it('shows an empty-file notice and still allows copying its exact whitespace', () => {
  expect(render(' \n').some(node => node.props.children === '（空文件）')).toBe(true);
  expect(render(' \n').find(node => node.type === 'Copy')?.props.text).toBe(' \n');
});
