import type { ChatProject } from './client/types';

export interface ProjectDirectory { name: string; path: string }
export interface ProjectDirectoriesResponse {
  directory: string;
  parent: string | null;
  entries: ProjectDirectory[];
  truncated: boolean;
}
export interface ProjectPickerProps {
  cwd?: string;
  load: (directory: string) => Promise<ProjectDirectoriesResponse>;
  choose: (project: ChatProject) => void;
  close: () => void;
}

export function directoryProject(directory: string): ChatProject {
  const label = directory.replace(/\\/g, '/').split('/').filter(Boolean).at(-1) || directory;
  return { cwd: directory, label };
}
