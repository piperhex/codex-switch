import { useMemo, useState } from 'react';
import { fileArea, fileTree, GIT_AREAS, type GitArea, type GitFileNode } from './gitFiles';
import type { GitChange } from './gitTypes';

export interface GitFileRow {
  id: string; name: string; path: string; depth: number; kind: 'area' | 'folder' | 'file';
  area: GitArea; files: GitChange[]; file?: GitChange; collapsed?: boolean;
}
function treeRows(nodes: GitFileNode[], options: {
  area: GitArea; collapsed: Set<string>; depth: number;
}): GitFileRow[] {
  return nodes.flatMap(node => {
    const id = `${options.area.id}:${node.path}`;
    const collapsed = options.collapsed.has(id);
    const row: GitFileRow = { id, name: node.name, path: node.path, depth: options.depth,
      kind: node.file ? 'file' : 'folder', area: options.area, files: node.files, file: node.file, collapsed };
    return [row, ...(collapsed ? [] : treeRows(node.children, { ...options, depth: options.depth + 1 }))];
  });
}
export function useGitFileList(files: GitChange[]) {
  const [mode, setMode] = useState<'tree' | 'flat'>('tree');
  const [collapsed, setCollapsed] = useState(new Set<string>());
  const rows = useMemo(() => GIT_AREAS.flatMap(area => {
    const group = files.filter(file => fileArea(file) === area.id);
    if (!group.length) return [];
    const heading: GitFileRow = { id: area.id, name: area.label, path: area.label, depth: 0,
      kind: 'area', area, files: group };
    const children: GitFileRow[] = mode === 'tree' ? treeRows(fileTree(group), { area, collapsed, depth: 0 })
      : [...group].sort((a, b) => a.path.localeCompare(b.path)).map(file => ({
        id: `${area.id}:${file.path}`, name: file.path.split('/').pop()!, path: file.path,
        depth: 0, kind: 'file', area, files: [file], file }));
    return [heading, ...children];
  }), [files, mode, collapsed]);
  const toggleFolder = (id: string) => setCollapsed(previous => {
    const next = new Set(previous);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  return { mode, setMode, rows, toggleFolder };
}
