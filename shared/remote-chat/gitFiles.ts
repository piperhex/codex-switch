import type { GitChange } from './gitTypes';

export const GIT_AREAS = [
  { id: 'conflict', label: '冲突', color: '#bf3945', background: '#fff0f1' },
  { id: 'unstaged', label: '未暂存', color: '#2868b2', background: '#edf4ff' },
  { id: 'staged', label: '已暂存', color: '#14785b', background: '#eaf7f0' },
  { id: 'mixed', label: '部分暂存', color: '#8256b5', background: '#f5efff' },
  { id: 'untracked', label: '新文件', color: '#9a6312', background: '#fff7e7' },
] as const;
export type GitArea = typeof GIT_AREAS[number];
export function fileArea(file: GitChange): GitArea['id'] {
  if (file.conflict) return 'conflict';
  if (file.status === '??') return 'untracked';
  if (file.status[0] === ' ') return 'unstaged';
  return file.status[1] === ' ' ? 'staged' : 'mixed';
}
export interface GitFileNode {
  path: string; name: string; files: GitChange[]; children: GitFileNode[]; file?: GitChange;
}
export function fileTree(files: GitChange[]): GitFileNode[] {
  const root: GitFileNode = { path: '', name: '', files: [], children: [] };
  for (const file of files) {
    let parent = root;
    const parts = file.path.split('/');
    parts.forEach((name, index) => {
      const path = parts.slice(0, index + 1).join('/');
      let node = parent.children.find(node => node.path === path);
      if (!node) {
        node = { path, name, files: [], children: [], file: index === parts.length - 1 ? file : undefined };
        parent.children.push(node);
      }
      node.files.push(file); parent = node;
    });
  }
  const sort = (nodes: GitFileNode[]): GitFileNode[] => nodes.sort((a, b) =>
    Number(!!a.file) - Number(!!b.file) || a.name.localeCompare(b.name)).map(node =>
    ({ ...node, children: sort(node.children) }));
  return sort(root.children);
}
export function selectionState(files: GitChange[], selected: Record<string, string>): boolean | 'mixed' {
  const selectable = files.filter(file => !file.conflict);
  const count = selectable.filter(file => selected[file.path] === file.version).length;
  if (!count) return false;
  return count === selectable.length ? true : 'mixed';
}
export function toggleFiles(previous: Record<string, string>, files: GitChange[]) {
  const next = { ...previous };
  const remove = selectionState(files, previous) === true;
  for (const file of files.filter(file => !file.conflict)) {
    if (remove) delete next[file.path]; else next[file.path] = file.version;
  }
  return next;
}
