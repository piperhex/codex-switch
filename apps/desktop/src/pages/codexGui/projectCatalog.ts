export interface SavedProject { path: string; name: string }

const STORAGE_KEY = "codex-switch:gui-projects";

export function folderName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() || "最近";
}

export function readProjects(): SavedProject[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is SavedProject => item && typeof item === "object"
      && typeof item.path === "string" && Boolean(item.path.trim())
      && typeof item.name === "string" && Boolean(item.name.trim()));
  } catch { return []; /* Optional preferences may be unavailable. */ }
}

export function projectName(path: string) {
  return readProjects().find((project) => project.path === path)?.name ?? folderName(path);
}

export function saveProject(project: SavedProject) {
  const projects = [project, ...readProjects().filter((item) => item.path !== project.path)];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
  return projects;
}

export function removeSavedProject(path: string) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(readProjects().filter((project) => project.path !== path)));
}
