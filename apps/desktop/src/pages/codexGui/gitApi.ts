import { invoke } from "../../api/backend";

export interface GitStatus {
  cwd: string;
  branch: string | null;
  branches: { name: string; occupied: boolean }[];
  changedFiles: number;
  isWorktree: boolean;
}
export type GitRequest = { operation: "status"; cwd: string }
  | { operation: "switch"; cwd: string; branch: string; create: boolean }
  | { operation: "createWorktree"; cwd: string; branch: string };

export const gitApi = {
  request: (request: GitRequest) => invoke<GitStatus>("codex_gui_git", { request }),
  undo: (request: { threadId: string; turnId: string; checkOnly?: boolean }) =>
    invoke<{ undone: boolean }>("codex_gui_undo", { request }),
};
