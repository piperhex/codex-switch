import { useEffect, useMemo, useState } from 'react';
import type { GitClient, GitCommitFile } from './gitTypes';

/** Keep the file list while viewing a diff, and ignore responses from a previous repository or commit. */
export function useGitCommitFiles(client: GitClient, cwd: string, commit: string | undefined, enabled: boolean) {
  const scope = useMemo(() => ({}), [client, cwd, commit, enabled]);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ scope: object; files?: GitCommitFile[]; error?: string }>();
  useEffect(() => {
    let alive = true;
    setResult(undefined);
    if (commit && enabled) void client.commitFiles(cwd, commit).then(files => {
      if (alive) setResult({ scope, files });
    }).catch(error => {
      if (!alive) return;
      const message = typeof error === 'string' ? error : error instanceof Error ? error.message
        : '无法读取变更文件，请重试。';
      setResult({ scope, error: message });
    });
    return () => { alive = false; };
  }, [client, cwd, commit, enabled, scope, attempt]);
  const current = result?.scope === scope ? result : undefined;
  return { files: current?.files, error: current?.error, retry: () => setAttempt(value => value + 1) };
}

export type CommitFilesState = ReturnType<typeof useGitCommitFiles>;
