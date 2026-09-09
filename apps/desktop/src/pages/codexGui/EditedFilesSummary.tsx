import { useId, useMemo, useState, type ReactNode } from "react";
import { ChevronDown, FileDiff } from "lucide-react";
import type { DiffFile } from "./diff";
import styles from "./EditedFilesSummary.module.less";

const COLLAPSED_FILE_COUNT = 3;

function Counts({ added, removed }: { added: number; removed: number }) {
  return <span className={styles.counts} aria-label={`新增 ${added} 行，删除 ${removed} 行`}>
    <span className={styles.added}>+{added}</span><span className={styles.removed}>−{removed}</span>
  </span>;
}

function summarizeFiles(files: DiffFile[]) {
  const paths = new Map<string, { path: string; added: number; removed: number }>();
  for (const file of files) {
    const previous = paths.get(file.path);
    paths.set(file.path, { path: file.path, added: (previous?.added ?? 0) + file.added,
      removed: (previous?.removed ?? 0) + file.removed });
  }
  return [...paths.values()];
}

export function EditedFilesSummary({ files, title, status, onReview, onReviewFile, undo }: {
  files: DiffFile[]; title: string; status?: string; onReview: () => void;
  onReviewFile: (path: string) => void;
  undo?: ReactNode;
}) {
  const listId = useId();
  const [expanded, setExpanded] = useState(false);
  const summary = useMemo(() => summarizeFiles(files), [files]);
  const added = summary.reduce((sum, file) => sum + file.added, 0);
  const removed = summary.reduce((sum, file) => sum + file.removed, 0);
  const changed = !["未应用", "修改失败", "正在修改", "已撤销"].includes(status ?? "");
  const hiddenCount = summary.length - COLLAPSED_FILE_COUNT;
  const visibleFiles = expanded ? summary : summary.slice(0, COLLAPSED_FILE_COUNT);
  return <section className={styles.card} aria-label={title}>
    <header className={styles.header}>
      <span className={styles.icon}><FileDiff size={21} aria-hidden="true" /></span>
      <div className={styles.overview}>
        <strong>{changed ? "已编辑" : status} {summary.length} 个文件</strong>
        <Counts added={added} removed={removed} />
      </div>
      {undo}<button type="button" className={styles.review} onClick={onReview}
        aria-label={`查看${title}：${summary.length} 个文件，新增 ${added} 行，删除 ${removed} 行`}>审核</button>
    </header>
    <ul className={styles.files} id={listId}>
      {visibleFiles.map((file) => <li key={file.path}>
        <button type="button" className={styles.path} onClick={() => onReviewFile(file.path)}
          aria-label={`查看 ${file.path} 的差异`}>{file.path}</button>
        <Counts added={file.added} removed={file.removed} />
      </li>)}
    </ul>
    {hiddenCount > 0 && <button type="button" className={styles.toggle} aria-expanded={expanded}
      aria-controls={listId} onClick={() => setExpanded((value) => !value)}>
      {expanded ? "收起文件列表" : `再显示 ${hiddenCount} 个文件`}
      <ChevronDown size={16} className={expanded ? styles.rotated : undefined} aria-hidden="true" />
    </button>}
  </section>;
}
