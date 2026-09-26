const FILE_STATUS = {
  A: { label: '新增', color: '#14785b', background: '#eaf7f0' },
  M: { label: '修改', color: '#2868b2', background: '#edf4ff' },
  D: { label: '删除', color: '#bf3945', background: '#fff0f1' },
  R: { label: '重命名', color: '#8256b5', background: '#f5efff' },
  C: { label: '复制', color: '#8256b5', background: '#f5efff' },
  T: { label: '类型变更', color: '#9a6312', background: '#fff7e7' },
} as const;

export function commitFileStatus(status: string) {
  return FILE_STATUS[status as keyof typeof FILE_STATUS]
    ?? { label: '变更', color: '#718078', background: '#f2f5f3' };
}
