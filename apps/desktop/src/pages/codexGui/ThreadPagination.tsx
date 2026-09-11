import { ChevronDown, LoaderCircle } from "lucide-react";
import styles from "./ThreadPagination.module.less";

export function ThreadPagination({ loading }: { loading: boolean }) {
  const Icon = loading ? LoaderCircle : ChevronDown;
  return <div className={styles.footer} role="status" aria-live="polite">
    <span className={styles.hint}>
      <Icon size={13} strokeWidth={1.6} className={loading ? styles.spinner : undefined} aria-hidden="true" />
      <span>{loading ? "正在加载更多对话…" : "向下滚动，查看更多"}</span>
    </span>
  </div>;
}
