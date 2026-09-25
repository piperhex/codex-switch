import { createRequire } from 'node:module';
import { expect, it } from 'vitest';
import { conversationEntries } from '../../../shared/chat/turnPresentation';
import type { Turn } from '../../../shared/remote-chat/client/types';

interface Range { first: number; last: number }
interface RenderMask { numCells: () => number; enumerateRegions: () => (Range & { isSpacer: boolean })[] }
interface ListProps {
  data: string[]; getItemCount: (data: string[]) => number; getItem: (data: string[], index: number) => string;
  keyExtractor: (item: string) => string; maintainVisibleContentPosition: { minIndexForVisible: number };
}
interface ListState {
  cellsAroundViewport: Range; renderMask: RenderMask;
  firstVisibleItemKey: string | null; pendingScrollUpdateCount: number;
}
interface ListStateMachine {
  getDerivedStateFromProps: (props: ListProps, state: ListState) => ListState;
  _createRenderMask: (props: ListProps, range: Range) => RenderMask;
  _constrainToItemCount: (range: Range, props: ListProps) => Range;
}

const require = createRequire(import.meta.url);
const { patchListRenderRange } = require('./patch-list-render-range.cjs') as {
  patchListRenderRange: (source: string) => string;
};
const { loadListStateMachine, readListSource } = require('./test-virtualized-list.cjs') as {
  loadListStateMachine: (source: string) => ListStateMachine; readListSource: () => string;
};
const patchedSource = patchListRenderRange(readListSource());
// Restore just the original constraint so the same regression exercises both native implementations.
const originalSource = patchedSource.replace('last: clamp(first - 1, cells.last, lastPossibleCellIndex)',
  'last: Math.min(lastPossibleCellIndex, cells.last)');
const fixed = loadListStateMachine(patchedSource);
const original = loadListStateMachine(originalSource);

function props(data: string[], minIndexForVisible = 0): ListProps {
  return { data, getItemCount: items => items.length, getItem: (items, index) => items[index],
    keyExtractor: item => item, maintainVisibleContentPosition: { minIndexForVisible } };
}

function initialState(list: ListStateMachine, data: string[], range: Range = { first: 0, last: -1 }): ListState {
  return { cellsAroundViewport: range, renderMask: list._createRenderMask(props(data), range),
    firstVisibleItemKey: data[0] ?? null, pendingScrollUpdateCount: 0 };
}

function resumeHistory(list: ListStateMachine) {
  const turn: Turn = { id: 'turn', status: 'cached', items: [
    { id: 'tool', type: 'commandExecution', command: 'pwd', status: 'inProgress' },
  ] };
  const cached = conversationEntries([turn]).map(entry => entry.id);
  const resumed = conversationEntries([{ ...turn, status: 'inProgress' }]).map(entry => entry.id);
  // Background layout can leave the viewport range empty while the retained initial cells are rendered.
  const loaded = list.getDerivedStateFromProps(props(cached), initialState(list, []));
  return list.getDerivedStateFromProps(props(resumed, 1), loaded);
}

it('reproduces the reported [0, -2] crash when cached activity expands after reconnecting', () => {
  expect(() => resumeHistory(original)).toThrow('Invalid cells around viewport "[0, -2]"');
  const resumed = resumeHistory(fixed);
  expect(resumed.cellsAroundViewport).toEqual({ first: 0, last: -1 });
  expect(resumed.renderMask.enumerateRegions()).toEqual([{ first: 0, last: 1, isSpacer: false }]);
});

it('retains valid ranges through repeated offline, resumed and empty history transitions', () => {
  let state = initialState(fixed, []);
  for (let cycle = 0; cycle < 3; cycle++) {
    for (const next of [props(['work']), props(['work', 'message'], 1), props(['work']), props([])]) {
      state = fixed.getDerivedStateFromProps(next, state);
      expect(state.renderMask.numCells()).toBe(next.data.length);
      expect(state.cellsAroundViewport.first).toBeGreaterThanOrEqual(0);
      expect(state.cellsAroundViewport.last).toBeGreaterThanOrEqual(state.cellsAroundViewport.first - 1);
      expect(state.cellsAroundViewport.last).toBeLessThan(next.data.length);
    }
  }
});

it('preserves the visible message range when older messages are prepended', () => {
  const data = Array.from({ length: 30 }, (_, index) => `message-${index}`);
  const state = initialState(fixed, data, { first: 10, last: 20 });
  const updated = fixed.getDerivedStateFromProps(props(['older-1', 'older-2', ...data]), state);
  expect(updated.cellsAroundViewport).toEqual({ first: 12, last: 22 });
  expect(updated.pendingScrollUpdateCount).toBe(1);
});

it.each([0, 1, 2, 12, 40])('keeps shifted ranges valid when history contains %i entries', (count) => {
  const next = props(Array.from({ length: count }, (_, index) => `item-${index}`));
  for (const range of [{ first: -5, last: -2 }, { first: 0, last: -1 },
    { first: 4, last: 12 }, { first: 20, last: 39 }]) {
    const constrained = fixed._constrainToItemCount(range, next);
    expect(() => fixed._createRenderMask(next, constrained)).not.toThrow();
  }
});

it('is idempotent and preserves Windows line endings', () => {
  expect(patchListRenderRange(patchedSource)).toBe(patchedSource);
  const windowsSource = patchedSource.replace(/\r?\n/g, '\r\n');
  expect(patchListRenderRange(windowsSource)).toBe(windowsSource);
});

it('rejects changed or ambiguous dependency source', () => {
  expect(() => patchListRenderRange('unexpected source')).toThrow('source changed');
  expect(() => patchListRenderRange(patchedSource + patchedSource)).toThrow('source changed');
});
