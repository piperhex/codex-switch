export interface GitChange {
  path: string; originalPath: string | null; status: string; conflict: boolean; version: string;
}
export interface GitChanges {
  root: string; branch: string | null; head: string | null; files: GitChange[];
}
export interface GitDiff { text: string; truncated: boolean }
export interface GitCommit {
  hash: string; parents: string[]; author: string; date: string; subject: string; refs: string[];
}
export interface GitHistory { commits: GitCommit[]; hasMore: boolean }
export interface GitCommitRequest {
  cwd: string; head: string | null; message: string; files: { path: string; version: string }[];
}
export interface GitClient {
  changes: (cwd: string) => Promise<GitChanges>;
  diff: (cwd: string, path: string, commit?: string) => Promise<GitDiff>;
  history: (cwd: string, skip: number) => Promise<GitHistory>;
  commit: (request: GitCommitRequest) => Promise<{ hash: string }>;
}
