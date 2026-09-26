import { createGitFixture } from '../../../shared/remote-chat/testing/gitFixture';
import type { GitActionRequest, GitCommitRequest } from '../../../shared/remote-chat/gitTypes';

const git = createGitFixture();
export function demoGitTools(input: Record<string, unknown>) {
  const cwd = String(input.cwd);
  switch (input.operation) {
    case 'guiGitRepository': return git.repository(cwd);
    case 'guiGitAction': return git.action(input as unknown as GitActionRequest) ?? null;
    case 'guiGitChanges': return git.changes(cwd);
    case 'guiGitHistory': return git.history(cwd, Number(input.skip));
    case 'guiGitDiff': return git.diff(cwd, String(input.path), input.commit as string | undefined);
    case 'guiGitCommit': return git.commit(input as unknown as GitCommitRequest);
  }
}
