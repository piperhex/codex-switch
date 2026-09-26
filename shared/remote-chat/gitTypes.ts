export interface GitChange {
  path: string; originalPath: string | null; status: string; conflict: boolean; version: string;
}
export interface GitChanges {
  root: string; branch: string | null; head: string | null; files: GitChange[];
}
export interface GitDiff { text: string; truncated: boolean }
export interface GitCommitFile { path: string; originalPath: string | null; status: string }
export interface GitCommit {
  hash: string; parents: string[]; author: string; date: string; subject: string; refs: string[];
}
export interface GitHistory { commits: GitCommit[]; hasMore: boolean }
export interface GitCommitRequest {
  cwd: string; head: string | null; message: string; files: { path: string; version: string }[];
}
export interface GitBranch {
  name: string; ref: string; remote: boolean; occupied: boolean;
}
export interface GitRepository {
  branches: GitBranch[]; remotes: string[]; upstream: string | null; ahead: number; behind: number;
}
export type GitAction = 'switch' | 'fetch' | 'pull' | 'update' | 'push';
export type GitStrategy = 'merge' | 'rebase';
export interface GitActionRequest {
  cwd: string; action: GitAction; head: string | null; branch: string | null;
  target?: string; strategy?: GitStrategy;
}
export interface GitClient {
  repository: (cwd: string) => Promise<GitRepository>;
  action: (request: GitActionRequest) => Promise<void>;
  changes: (cwd: string) => Promise<GitChanges>;
  diff: (cwd: string, path: string, commit?: string) => Promise<GitDiff>;
  history: (cwd: string, skip: number) => Promise<GitHistory>;
  commitFiles: (cwd: string, commit: string) => Promise<GitCommitFile[]>;
  commit: (request: GitCommitRequest) => Promise<{ hash: string }>;
}
