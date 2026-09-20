import * as React from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ChatHtmlPreview, isHtmlPath } from './ChatHtmlPreview';

const state = vi.hoisted(() => ({ mode: 'preview', failed: false }));
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof React>(),
  useMemo: (create: () => unknown) => create(),
  useState: (initial: unknown) => initial === 'preview'
    ? [state.mode, (mode: string) => { state.mode = mode; }]
    : [state.failed, (failed: boolean) => { state.failed = failed; }],
}));
vi.mock('react-native', () => ({ Pressable: 'Button', Text: 'Text', View: 'View',
  StyleSheet: { create: <T,>(styles: T) => styles }, useWindowDimensions: () => ({ height: 800 }),
}));
vi.mock('react-native-webview', () => ({ WebView: 'WebView' }));
vi.mock('../components/SheetScrollView', () => ({ SheetScrollView: 'ScrollView' }));
vi.mock('./ChatCodeBlock', () => ({ ChatCodeBlock: 'Code' }));

const html = '<!doctype html><html><body><svg></svg><script>document.title = "Preview"</script></body></html>';
type NodeProps = {
  children?: React.ReactNode; onPress: () => void; onError: () => void;
  onShouldStartLoadWithRequest: (request: { url: string }) => boolean;
  source?: { html: string }; text?: string; [key: string]: unknown;
};
function descendants(value: unknown): React.ReactElement<NodeProps>[] {
  if (Array.isArray(value)) return value.flatMap(descendants);
  if (!React.isValidElement<NodeProps>(value)) return [];
  return [value, ...descendants(value.props.children)];
}
function render() { return descendants(ChatHtmlPreview({ text: html })); }
function button(label: string) {
  return render().find(node => node.type === 'Button' && descendants(node.props.children)
    .some(child => child.props.children === label))!;
}

beforeEach(() => {
  vi.stubGlobal('React', React);
  state.mode = 'preview'; state.failed = false;
});

it('recognizes HTML and HTM files without treating other source files as pages', () => {
  for (const path of ['index.html', 'C:\\site\\INDEX.HTM', '/tmp/页面.HTML']) expect(isHtmlPath(path)).toBe(true);
  for (const path of ['index.html.txt', 'source.ts', 'page.xhtml']) expect(isHtmlPath(path)).toBe(false);
});

it('opens the rendered page by default and allows switching to source and back', () => {
  expect(render().find(node => node.type === 'WebView')?.props.source?.html).toBe(html);
  expect(render().some(node => node.type === 'Code')).toBe(false);
  button('源码').props.onPress();
  expect(render().some(node => node.type === 'WebView')).toBe(false);
  expect(render().find(node => node.type === 'Code')?.props.text).toBe(html);
  button('预览').props.onPress();
  expect(render().some(node => node.type === 'WebView')).toBe(true);
});

it('isolates the preview from local files, app cookies, and external navigation', () => {
  const props = render().find(node => node.type === 'WebView')!.props;
  expect(props).toMatchObject({ incognito: true, allowFileAccess: false,
    allowFileAccessFromFileURLs: false, allowUniversalAccessFromFileURLs: false,
    sharedCookiesEnabled: false, thirdPartyCookiesEnabled: false, originWhitelist: ['*'],
    javaScriptCanOpenWindowsAutomatically: false, setSupportMultipleWindows: false,
    geolocationEnabled: false, mediaCapturePermissionGrantType: 'deny',
  });
  expect(props.onMessage).toBeUndefined();
  for (const url of ['about:blank', 'about:blank#section']) {
    expect(props.onShouldStartLoadWithRequest({ url })).toBe(true);
  }
  for (const url of ['https://example.com', 'file:///private/data', 'intent://app', 'javascript:alert(1)']) {
    expect(props.onShouldStartLoadWithRequest({ url })).toBe(false);
  }
});

it('offers a retry and keeps source available after a rendering error', () => {
  render().find(node => node.type === 'WebView')!.props.onError();
  expect(render().some(node => node.props.accessibilityRole === 'alert')).toBe(true);
  button('源码').props.onPress();
  expect(render().find(node => node.type === 'Code')?.props.text).toBe(html);
  button('预览').props.onPress();
  button('重新预览').props.onPress();
  expect(render().some(node => node.type === 'WebView')).toBe(true);
});
