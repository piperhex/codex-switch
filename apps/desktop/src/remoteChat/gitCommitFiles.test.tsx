// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useGitDiff, useRemoteGit } from '../../../../shared/remote-chat/useRemoteGit';
import { useGitCommitFiles } from '../../../../shared/remote-chat/useGitCommitFiles';
import { createAsyncGitFixture } from '../../../../shared/remote-chat/testing/gitFixture';
import type { GitCommitFile } from '../../../../shared/remote-chat/gitTypes';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
function fixture() {
  const client = createAsyncGitFixture();
  client.commitFiles = vi.fn(client.commitFiles);
  client.diff = vi.fn(client.diff);
  const root = createRoot(document.createElement('div'));
  let panel!: ReturnType<typeof useRemoteGit>;
  let files!: ReturnType<typeof useGitCommitFiles>;
  let diff!: ReturnType<typeof useGitDiff>;
  function Fixture({ cwd, connected }: { cwd: string; connected: boolean }) {
    panel = useRemoteGit({ client, cwd, connected, active: true });
    files = useGitCommitFiles(client, cwd, panel.detail?.commit?.hash, connected);
    diff = useGitDiff(client, cwd, panel.detail, connected);
    return null;
  }
  return { client, panel: () => panel, files: () => files, diff: () => diff,
    dispose: () => act(async () => root.unmount()),
    render: (cwd = '/project', connected = true) => act(async () =>
      root.render(<Fixture cwd={cwd} connected={connected} />)) };
}

it('opens commit files before fetching one file diff and returns through both levels', async () => {
  const test = fixture();
  try {
    await test.render();
    const commit = test.panel().commits[0];
    await act(async () => { test.panel().setTab('history'); test.panel().setDetail({ kind: 'files', commit }); });
    expect(test.files().files).toHaveLength(4);
    expect(test.client.diff).not.toHaveBeenCalled();
    await act(async () => test.panel().setDetail({ kind: 'diff', path: 'src/chat/tools.ts', commit, title: 'tools.ts' }));
    expect(test.client.diff).toHaveBeenCalledExactlyOnceWith('/project', 'src/chat/tools.ts', commit.hash);
    expect(test.diff().value?.text).toContain('committed change');
    await act(async () => test.panel().backDetail());
    expect(test.panel().detail).toEqual({ kind: 'files', commit });
    expect(test.files().files).toHaveLength(4);
    expect(test.client.commitFiles).toHaveBeenCalledTimes(1);
    await act(async () => test.panel().backDetail());
    expect(test.panel().detail).toBeNull();
    expect(test.panel().tab).toBe('history');
  } finally { await test.dispose(); }
});

it('ignores a slow previous commit and clears files when changing repositories', async () => {
  const test = fixture();
  let finish!: (files: GitCommitFile[]) => void;
  vi.mocked(test.client.commitFiles).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  try {
    await test.render();
    await act(async () => test.panel().setDetail({ kind: 'files', commit: test.panel().commits[0] }));
    expect(test.files().files).toBeUndefined();
    await act(async () => test.panel().setDetail({ kind: 'files', commit: test.panel().commits[1] }));
    expect(test.files().files).toEqual([]);
    await act(async () => finish([{ path: 'stale.txt', originalPath: null, status: 'A' }]));
    expect(test.files().files).toEqual([]);
    await test.render('/other');
    expect(test.panel().detail).toBeNull();
    expect(test.files().files).toBeUndefined();
  } finally { await test.dispose(); }
});

it('retries a failed file list and does not load commit contents while offline', async () => {
  const test = fixture();
  vi.mocked(test.client.commitFiles).mockRejectedValueOnce(new Error('retry this read'));
  try {
    await test.render();
    await act(async () => test.panel().setDetail({ kind: 'files', commit: test.panel().commits[0] }));
    expect(test.files().error).toBe('retry this read');
    await act(async () => test.files().retry());
    expect(test.files().error).toBeUndefined();
    expect(test.files().files).toHaveLength(4);
    await test.render('/project', false);
    await act(async () => test.panel().setDetail({ kind: 'files', commit: test.panel().commits[1] }));
    expect(test.client.commitFiles).toHaveBeenCalledTimes(2);
    expect(test.client.diff).not.toHaveBeenCalled();
    expect(test.files().files).toBeUndefined();
  } finally { await test.dispose(); }
});
