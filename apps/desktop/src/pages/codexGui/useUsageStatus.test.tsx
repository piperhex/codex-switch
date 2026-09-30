// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '../../api/backend';
import { useUsageStatus } from './useUsageStatus';

vi.mock('../../api/backend', () => ({ invoke: vi.fn() }));
let root: Root;
let result: ReturnType<typeof useUsageStatus>;
function Probe({ active = true }: { active?: boolean }) { result = useUsageStatus(active); return null; }
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(invoke).mockReset(); root = createRoot(document.createElement('div'));
});
afterEach(async () => {
  await act(async () => root.unmount()); vi.useRealTimers(); vi.unstubAllGlobals();
});

it('keeps polling single-flight, reports failures, and stops while hidden', async () => {
  let reject!: (error: Error) => void;
  vi.mocked(invoke).mockReturnValue(new Promise((_, fail) => { reject = fail; }));
  await act(async () => root.render(<Probe />));
  await act(async () => vi.advanceTimersByTimeAsync(15_000));
  expect(invoke).toHaveBeenCalledExactlyOnceWith('codex_gui_usage_summary');
  await act(async () => reject(new Error('private error')));
  expect(result.error).not.toBe(''); expect(result.error).not.toContain('private');
  await act(async () => root.render(<Probe active={false} />));
  await act(async () => vi.advanceTimersByTimeAsync(15_000));
  expect(invoke).toHaveBeenCalledTimes(1);
});
