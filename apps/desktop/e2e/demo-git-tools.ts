import { createGitFixture } from '../../../shared/remote-chat/testing/gitFixture';
import type { GitCommitRequest } from '../../../shared/remote-chat/gitTypes';

const git = createGitFixture();
export function demoGitTools(input: Record<string, unknown>) {
  const cwd = String(input.cwd);
  switch (input.operation) {
    case 'guiGitChanges': return git.changes(cwd);
    case 'guiGitHistory': return git.history(cwd, Number(input.skip));
    case 'guiGitDiff': return git.diff(cwd, String(input.path), input.commit as string | undefined);
    case 'guiGitCommit': return git.commit(input as unknown as GitCommitRequest);
  }
}
