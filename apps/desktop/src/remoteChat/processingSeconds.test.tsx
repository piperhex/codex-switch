// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { useProcessingSeconds } from '../../../../shared/remote-chat/client/useProcessingSeconds';
import type { Turn } from '../pages/codexGui/types';

function Clock({ turn, active }: { turn: Turn; active: boolean }) {
  return <span>{useProcessingSeconds(turn, active)}</span>;
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('counts from the PC start time, survives streamed renders, and clears timers when inactive or complete', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers();
  vi.setSystemTime(100_000);
  const container = document.createElement('div');
  const root = createRoot(container);
  const turn = { id: 'running', status: 'inProgress', startedAt: 95, items: [] };
  await act(async () => root.render(<Clock turn={turn} active />));
  expect(container.textContent).toBe('5');
  await act(async () => vi.advanceTimersByTimeAsync(2000));
  await act(async () => root.render(<Clock turn={{ ...turn, items: [{ id: 'item', type: 'agentMessage' }] }} active />));
  expect(container.textContent).toBe('7');
  expect(vi.getTimerCount()).toBe(1);
  await act(async () => root.render(<Clock turn={turn} active={false} />));
  expect(vi.getTimerCount()).toBe(0);
  await act(async () => vi.advanceTimersByTimeAsync(3000));
  await act(async () => root.render(<Clock turn={turn} active />));
  expect(container.textContent).toBe('10');
  await act(async () => root.render(<Clock turn={{ ...turn, status: 'completed' }} active />));
  expect(vi.getTimerCount()).toBe(0);
  await act(async () => root.unmount());
});
