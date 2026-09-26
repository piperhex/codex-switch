import type { GitChanges, GitClient, GitCommit, GitCommitFile } from '../gitTypes';

const hash = (id: number) => ['f73a195b', 'ae102c38', 'c4397ed1', '72c48df0', 'e950cd31', '8f17d63a'][id - 1]
  .padEnd(40, String(id));
const commit = (id: number, parents: number[], subject: string, refs: string[] = []): GitCommit => ({
  hash: hash(id), parents: parents.map(hash), subject, refs, author: 'Alex', date: '2026-09-26T10:00:00+08:00',
});

/** Local UI fixtures never read or mutate a real repository. */
type SyncGitClient = { [Key in keyof GitClient]:
  (...args: Parameters<GitClient[Key]>) => Awaited<ReturnType<GitClient[Key]>> };

export function createGitFixture(): SyncGitClient {
  let branch = 'main';
  let files: GitChanges['files'] = [
    { path: 'src/app.ts', originalPath: null, status: ' M', conflict: false, version: 'app-v1' },
    { path: 'README.md', originalPath: null, status: 'M ', conflict: false, version: 'readme-v1' },
    { path: '新文件 [1].txt', originalPath: null, status: '??', conflict: false, version: 'new-v1' },
    { path: 'src/chat/tools.ts', originalPath: null, status: ' M', conflict: false, version: 'tools-v1' },
    { path: 'src/chat/menu.ts', originalPath: null, status: ' M', conflict: false, version: 'menu-v1' },
    { path: 'src/theme.css', originalPath: null, status: 'MM', conflict: false, version: 'theme-v1' },
  ];
  let commits = [commit(5, [3, 4], '合并工具面板', ['HEAD -> main']), commit(4, [2], '增加 Git 工具', ['feature/git']),
    commit(3, [2], '调整聊天界面'), commit(2, [1], '准备项目'), commit(1, [], '首次提交', ['tag: v1.0'])];
  const historyFiles = new Map<string, GitCommitFile[]>([[hash(5), [
    { path: 'src/app.ts', originalPath: null, status: 'M' },
    { path: 'src/chat/tools.ts', originalPath: null, status: 'A' },
    { path: 'src/chat/legacy.ts', originalPath: null, status: 'D' },
    { path: 'docs/工具说明.md', originalPath: 'docs/旧说明.md', status: 'R' },
  ]]]);
  return {
    repository: () => ({ upstream: `origin/${branch}`, ahead: 2, behind: 1, remotes: ['origin'], branches: [
      { name: 'main', ref: 'refs/heads/main', remote: false, occupied: false },
      { name: 'feature/git', ref: 'refs/heads/feature/git', remote: false, occupied: false },
      { name: 'release', ref: 'refs/heads/release', remote: false, occupied: true },
      { name: 'origin/develop', ref: 'refs/remotes/origin/develop', remote: true, occupied: false },
    ] }),
    action: input => {
      if (input.action === 'switch') branch = input.target!.replace(/^refs\/(heads|remotes\/origin)\//, '');
      if ((input.action === 'pull' || input.action === 'update') && files.length) {
        throw new Error('请先提交本地改动，再拉取或更新项目。');
      }
    },
    changes: cwd => ({ root: cwd, branch, head: commits[0].hash, files: [...files] }),
    history: (_cwd, skip) => ({ commits: commits.slice(skip, skip + 3), hasMore: skip + 3 < commits.length }),
    commitFiles: (_cwd, commit) => historyFiles.get(commit) ?? [],
    diff: (_cwd, path, commit) => ({ text: `diff --git a/${path || 'src/app.ts'} b/${path || 'src/app.ts'}\n`
      + '@@ -1 +1 @@\n-old code\n+new code\n' + (commit ? '+committed change\n' : ''), truncated: false }),
    commit: input => {
      if (input.message === 'fail') throw new Error('提交未完成，请在电脑上检查 Git 用户信息、提交检查和签名设置。');
      const selected = new Set(input.files.map(file => file.path));
      historyFiles.set(hash(6), files.filter(file => selected.has(file.path)).map(file => ({
        path: file.path, originalPath: file.originalPath, status: file.status === '??' ? 'A' : 'M' })));
      files = files.filter(file => !selected.has(file.path));
      commits = [commit(6, [5], input.message, ['HEAD -> main']),
        ...commits.map(entry => ({ ...entry, refs: entry.refs.filter(ref => ref !== 'HEAD -> main') }))];
      return { hash: hash(6) };
    },
  };
}

export function createAsyncGitFixture(): GitClient {
  const git = createGitFixture();
  return { repository: async cwd => git.repository(cwd), action: async input => git.action(input),
    changes: async cwd => git.changes(cwd), history: async (cwd, skip) => git.history(cwd, skip),
    commitFiles: async (cwd, commit) => git.commitFiles(cwd, commit),
    diff: async (cwd, path, commit) => git.diff(cwd, path, commit), commit: async input => git.commit(input) };
}
