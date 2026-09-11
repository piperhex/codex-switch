import type { ProjectFilesResponse } from '../../../shared/remote-chat/projectFiles';

const ROOT = 'F:/projects/demo';

/** Predictable data for testing native picker navigation without reading a user's computer. */
export function demoProjectFiles(input: Record<string, unknown>): ProjectFilesResponse {
  const directory = typeof input.directory === 'string' && input.directory ? input.directory : ROOT;
  if (directory !== ROOT && directory !== `${ROOT}/assets`) throw new Error('Unknown fixture directory');
  const entries = directory === ROOT ? [
    { name: 'assets', path: `${ROOT}/assets`, directory: true },
    { name: 'README.md', path: `${ROOT}/README.md`, directory: false },
  ] : [
    { name: 'sample.png', path: `${ROOT}/assets/sample.png`, directory: false },
    { name: 'notes.txt', path: `${ROOT}/assets/notes.txt`, directory: false },
  ];
  return { directory, parent: directory === ROOT ? null : ROOT, truncated: false,
    entries: entries.filter((entry) => !input.imagesOnly || entry.directory || entry.name.endsWith('.png')) };
}

export const demoPlugins = [{ id: 'github@fixture', name: 'GitHub', installed: true, enabled: true }];
