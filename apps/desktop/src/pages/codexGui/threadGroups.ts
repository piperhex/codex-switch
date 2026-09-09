import { projectName } from "./projectCatalog";
import type { GuiState, Thread } from "./types";

export function threadGroups(state: GuiState) {
  const pinned = state.threads.filter((thread) => state.pins.includes(thread.id));
  const byProject = new Map<string, Thread[]>();
  state.threads.filter((thread) => !state.pins.includes(thread.id)).forEach((thread) => {
    const key = thread.cwd || "";
    byProject.set(key, [...(byProject.get(key) ?? []), thread]);
  });
  const projects = Array.from(byProject, ([path, threads]) => ({
    id: `project:${path}`, label: projectName(path), pinned: false, cwd: path, threads,
  }));
  projects.sort((left, right) => Number(state.pinnedProjects.includes(right.cwd))
    - Number(state.pinnedProjects.includes(left.cwd)));
  return [
    ...(pinned.length ? [{ id: "pinned", label: "置顶", pinned: true, cwd: "", threads: pinned }] : []),
    ...projects,
  ];
}
