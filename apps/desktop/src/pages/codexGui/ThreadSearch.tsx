import { useEffect, useRef, useState } from "react";
import { Button, Input, Modal, Spin, type InputRef } from "antd";
import { Search } from "lucide-react";
import type { GuiController } from "./controller";
import type { GuiState } from "./types";
import { projectName, threadTitle } from "./ThreadSidebar";
import styles from "./threadSearch.module.less";

const SEARCH_DELAY_MS = 300;

export function ThreadSearch({ state, controller, onClose }: {
  state: GuiState; controller: GuiController; onClose: () => void;
}) {
  const [search, setSearch] = useState(state.search);
  const input = useRef<InputRef>(null);
  const loading = state.loading || search !== state.search;
  useEffect(() => {
    if (search === state.search || state.connection !== "ready") return;
    const timer = setTimeout(() => controller.filter(search, state.archived), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [search, state.search, state.archived, state.connection, controller]);

  return <Modal open title="搜索对话" footer={null} width={400} onCancel={onClose}
    afterOpenChange={(open) => { if (open) input.current?.focus(); }}>
    <Input ref={input} prefix={<Search size={15} />} placeholder="搜索对话" aria-label="搜索对话"
      value={search} allowClear onChange={(event) => setSearch(event.target.value)} />
    <div className={styles.results} aria-busy={loading}>
      <p className={styles.label}>{state.archived ? "已归档" : "最近对话"}</p>
      {loading ? <div className={styles.empty}><Spin size="small" /></div> : <>
        {state.threads.map((thread) => <button key={thread.id} className={styles.result}
          disabled={state.sending || state.connection !== "ready"} onClick={() => {
            void controller.select(thread.id);
            onClose();
          }}>
          <span className={styles.title}>{threadTitle(thread)}</span>
          <span className={styles.project}>{projectName(thread.cwd)}</span>
        </button>)}
        {!state.threads.length && <p className={styles.empty} role="status">
          {search.trim() ? "没有找到匹配的对话" : "还没有对话"}
        </p>}
      </>}
      {state.cursor && <Button type="text" block loading={loading} disabled={state.connection !== "ready"}
        onClick={() => void controller.refresh(true)}>加载更多</Button>}
    </div>
  </Modal>;
}
