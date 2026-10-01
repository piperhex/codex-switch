import { guiText } from "../../i18n/guiText";
import { useRef, useState, type ReactNode } from "react";
import { Button, Modal } from "antd";
import { Maximize2 } from "lucide-react";
import { CopyButton } from "./CopyButton";
import styles from "./MarkdownTable.module.less";

export function MarkdownTable({ children }: { children?: ReactNode }) {
  const table = useRef<HTMLTableElement>(null);
  const [expanded, setExpanded] = useState(false);
  const copyText = () => Array.from(table.current?.rows ?? [], (row) =>
    Array.from(row.cells, (cell) => (cell.textContent ?? "").trim()).join("\t")).join("\n");
  return <div className={styles.wrapper}>
    <div className={styles.viewport} tabIndex={0} role="region" aria-label={guiText("表格")}>
      <table ref={table} className={styles.table}>{children}</table>
    </div>
    <div className={styles.actions} data-quote-exclude>
      <Button type="text" size="small" aria-label={guiText("展开表格")} icon={<Maximize2 size={14} />}
        onClick={() => setExpanded(true)} />
      <CopyButton text={copyText} label={guiText("复制表格")} />
    </div>
    <Modal open={expanded} title={guiText("表格")} footer={null} onCancel={() => setExpanded(false)}
      width="min(1100px, calc(100vw - 32px))" className={styles.dialog}>
      <div className={styles.expandedActions}><CopyButton text={copyText} label={guiText("复制表格")} /></div>
      <div className={styles.viewport} tabIndex={0} role="region" aria-label={guiText("完整表格")}>
        {expanded && <table className={styles.table}>{children}</table>}
      </div>
    </Modal>
  </div>;
}
