import { memo, useMemo, useState } from "react";
import { ChevronDown, FileDiff } from "lucide-react";
import type { DiffFile, DiffLine } from "./diff";
import { pairDiffLines } from "./diff";
import { CopyButton } from "./CopyButton";
import styles from "./DiffView.module.less";

const PAGE_LINES = 200;
const KIND_LABELS: Record<string, string> = { add: "新增", delete: "删除", update: "修改" };

function Counts({ added, removed }: { added: number; removed: number }) {
  return <span className={styles.counts} aria-label={`新增 ${added} 行，删除 ${removed} 行`}>
    <span className={styles.added}>+{added}</span><span className={styles.removed}>−{removed}</span>
  </span>;
}

function UnifiedLine({ line }: { line: DiffLine }) {
  const sign = { add: "+", remove: "−", context: " ", hunk: " ", meta: " " }[line.kind];
  return <div className={`${styles.line} ${styles[line.kind]}`}>
    <span className={styles.number}>{line.oldLine}</span><span className={styles.number}>{line.newLine}</span>
    <span className={styles.sign} aria-hidden="true">{sign}</span>
    <code>{line.text || " "}</code>
  </div>;
}

function SplitCell({ line, side }: { line?: DiffLine; side: "left" | "right" }) {
  return <div className={`${styles.cell} ${line ? styles[line.kind] : styles.empty}`}>
    <span className={styles.number}>{side === "left" ? line?.oldLine : line?.newLine}</span>
    <code>{line?.text || " "}</code>
  </div>;
}

function DiffContent({ file, split }: { file: DiffFile; split: boolean }) {
  const [limit, setLimit] = useState(PAGE_LINES);
  const pairs = useMemo(() => split ? pairDiffLines(file.lines) : [], [file.lines, split]);
  const total = split ? pairs.length : file.lines.length;
  return <>
    <div className={styles.fileToolbar}>
      <span>{file.previousPath ? `${file.previousPath} → ${file.path}` : file.path}</span>
      <CopyButton text={file.raw} label="复制 diff" />
    </div>
    {total ? <div className={styles.codeScroll} tabIndex={0} aria-label={`${file.path} 的代码差异`}>
      {split ? <div className={styles.split}>
        <div className={styles.splitLabels}><span>修改前</span><span>修改后</span></div>
        {pairs.slice(0, limit).map((pair, index) => pair.heading
          ? <div key={index} className={styles[pair.heading.kind]}><code>{pair.heading.text}</code></div>
          : <div key={index} className={styles.pair}>
            <SplitCell line={pair.left} side="left" /><SplitCell line={pair.right} side="right" />
          </div>)}
      </div> : file.lines.slice(0, limit).map((line, index) => <UnifiedLine line={line} key={index} />)}
    </div> : <p className={styles.notice}>{file.kind === "add" ? "新增空文件" : "此文件没有可显示的文本差异。"}</p>}
    {limit < total && <button className={styles.more} onClick={() => setLimit((value) => value + PAGE_LINES)}>
      继续显示（还有 {total - limit} 行）</button>}
  </>;
}

const FileCard = memo(function FileCard({ file, split }: { file: DiffFile; split: boolean }) {
  const [open, setOpen] = useState(false);
  const label = file.previousPath ? "重命名" : KIND_LABELS[file.kind] ?? "修改";
  return <section className={styles.file}>
    <button className={styles.fileHeader} aria-expanded={open} onClick={() => setOpen(!open)}>
      <FileDiff size={15} /><span className={styles.path}>{file.path.split(/[\\/]/).pop()}</span>
      <span className={styles.kind}>{label}</span><Counts added={file.added} removed={file.removed} />
      <ChevronDown size={14} className={open ? styles.rotated : undefined} />
    </button>
    {open && <DiffContent file={file} split={split} />}
  </section>;
});

export const DiffView = memo(function DiffView({ files, title = "文件修改", status }: {
  files: DiffFile[]; title?: string; status?: string;
}) {
  const [split, setSplit] = useState(false);
  if (!files.length) return null;
  const added = files.reduce((sum, file) => sum + file.added, 0);
  const removed = files.reduce((sum, file) => sum + file.removed, 0);
  const fileCount = new Set(files.map((file) => file.path)).size;
  return <div className={styles.diff}>
    <div className={styles.toolbar}><strong>{title}</strong><span>{fileCount} 个文件</span>
      <Counts added={added} removed={removed} />
      {status && <span role="status">{status}</span>}
      <div className={styles.modes} role="group" aria-label="差异显示方式">
        <button aria-pressed={!split} onClick={() => setSplit(false)}>统一</button>
        <button aria-pressed={split} onClick={() => setSplit(true)}>并排</button>
      </div>
    </div>
    {files.map((file, index) => <FileCard key={`${file.path}:${index}`} file={file} split={split} />)}
  </div>;
});
