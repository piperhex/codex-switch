import { invoke } from '../../api/backend';
import type { GitClient } from '../../../../../shared/remote-chat/gitTypes';

/** Use the same Git service as remote viewers, on this computer's native command worker. */
export const localGitClient: GitClient = {
  repository: cwd => invoke('codex_gui_git_tool', { request: { operation: 'repository', cwd } }),
  action: request => invoke('codex_gui_git_tool', { request: { ...request, operation: 'action' } }),
  changes: cwd => invoke('codex_gui_git_tool', { request: { operation: 'changes', cwd } }),
  diff: (cwd, path, commit) => invoke('codex_gui_git_tool', { request: { operation: 'diff', cwd, path, commit } }),
  history: (cwd, skip) => invoke('codex_gui_git_tool', { request: { operation: 'history', cwd, skip } }),
  commitFiles: (cwd, commit) => invoke('codex_gui_git_tool', { request: { operation: 'commitFiles', cwd, commit } }),
  commit: request => invoke('codex_gui_git_tool', { request: { ...request, operation: 'commit' } }),
};
