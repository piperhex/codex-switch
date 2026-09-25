import type { TerminalInfo } from '../terminal/types';

/** Keep the project chosen at creation, even when the shell changes directory. */
export function terminalProjectKey(cwd: string): string {
  if (!cwd.trim()) return '';
  const windows = /^[a-z]:[\\/]/i.test(cwd) || cwd.startsWith('\\\\') || cwd.startsWith('//');
  let path = windows ? cwd.replace(/\\/g, '/').toLowerCase() : cwd;
  if (windows) path = path.replace(/^\/\/\?\/unc\//, '//').replace(/^\/\/\?\//, '');
  return path.replace(/\/+$/, '') || '/';
}

export function terminalBelongsToProject(session: TerminalInfo, cwd: string): boolean {
  return terminalProjectKey(session.projectCwd ?? session.cwd) === terminalProjectKey(cwd);
}
