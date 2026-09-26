import React, { Children, isValidElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { answer } from '../../../../shared/chat/lineBreakFixture.json';
import { ChatMarkdown } from './Markdown';

vi.mock('react', async importOriginal => ({ ...await importOriginal<typeof React>(),
  memo: <T,>(component: T) => component,
  useMemo: <T,>(compute: () => T) => compute(),
  useState: <T,>(initial: T) => [initial, vi.fn()],
  useContext: () => undefined,
}));
vi.mock('react-native', () => ({ Text: 'Text', View: 'View', ScrollView: 'ScrollView', Pressable: 'Pressable',
  Linking: { openURL: vi.fn() }, StyleSheet: { create: <T,>(styles: T) => styles },
}));
vi.mock('./ChatCodeBlock', () => ({ ChatCodeBlock: 'Code' }));
vi.mock('./ChatDiff', () => ({ ChatDiff: 'Diff' }));
vi.mock('./ChatCodeReview', () => ({ ChatCodeReview: 'Review' }));
vi.mock('./ChatMath', () => ({ ChatMath: 'Math' }));
vi.mock('./ChatImage', () => ({ ChatImage: 'Image' }));
vi.mock('./ChatFilePreview', () => ({ ChatFileContext: {} }));
vi.mock('./SelectableChatText', () => ({ SelectableChatText: 'SelectableText' }));

beforeEach(() => vi.stubGlobal('React', React));
afterEach(() => vi.unstubAllGlobals());

// Render the actual Markdown components while leaving native layout to device verification.
function textContent(node: ReactNode): string {
  return Children.toArray(node).map(child => {
    if (typeof child === 'string' || typeof child === 'number') return String(child);
    if (!isValidElement<{ children?: ReactNode }>(child)) return '';
    if (typeof child.type === 'function') {
      return textContent((child.type as (props: unknown) => ReactNode)(child.props));
    }
    return textContent(child.props.children);
  }).join('');
}

it.each([false, true])('keeps every model separator and answer line (user=%s)', user => {
  expect(textContent(<ChatMarkdown text={answer} user={user} />)).toBe(answer);
});

it('keeps soft and explicit breaks across inline formatting without inserting blank lines', () => {
  expect(textContent(<ChatMarkdown text={'第一行\n**第二行**  \n第三行\\\n第四行'} />))
    .toBe('第一行\n第二行\n第三行\n第四行');
});
