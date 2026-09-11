import { useEffect, useState } from 'react';
import type { ProjectDirectoriesResponse, ProjectPickerProps } from '../projectDirectories';

export function useProjectDirectories({ load, cwd = '' }: Pick<ProjectPickerProps, 'load' | 'cwd'>) {
  const [directory, setDirectory] = useState(cwd);
  const [result, setResult] = useState<ProjectDirectoriesResponse>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(''); setResult(undefined);
    void load(directory)
      .then((value) => { if (!cancelled) setResult(value); })
      .catch(() => { if (!cancelled) setError('暂时无法读取文件夹，请确认电脑已连接且文件夹可访问。'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [load, directory, revision]);
  const browse = (path: string) => {
    setResult(undefined); setLoading(true); setDirectory(path); setRevision((value) => value + 1);
  };
  return { result, loading, error, browse, retry: () => browse(directory) };
}
