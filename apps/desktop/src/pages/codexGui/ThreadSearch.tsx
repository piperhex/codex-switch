import { guiText } from "../../i18n/guiText";
import { useEffect, useRef, useState } from "react";
import { Button, Input, Modal, Spin, type InputRef } from "antd";
import { ArrowUpRight, Folder, MessageSquare, Search } from "lucide-react";
import type { GuiController } from "./controller";
import type { GuiState } from "./types";
import { projectName, threadTitle } from "./ThreadSidebar";
import styles from "./threadSearch.module.less";

const SEARCH_DELAY_MS = 300;
const SEARCH_MODAL_WIDTH = 720;

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

  return <Modal open centered className={styles.modal} title={guiText("搜索对话")} footer={null}
    width={SEARCH_MODAL_WIDTH} onCancel={onClose}
    afterOpenChange={(open) => { if (open) input.current?.focus(); }}>
    <p className={styles.description}>{guiText("找到之前的对话，接着聊。")}</p>
    <Input ref={input} className={styles.search} prefix={<Search size={20} aria-hidden="true" />}
      placeholder={guiText("输入关键词，搜索对话")} aria-label={guiText("搜索对话")}
      value={search} allowClear onChange={(event) => setSearch(event.target.value)} />
    <div className={styles.sectionHeading}>
      <span>{search.trim() ? guiText("搜索结果") : state.archived ? guiText("已归档对话") : guiText("最近对话")}</span>
      {!loading && <span className={styles.count}>{state.threads.length}{state.cursor ? "+" : ""}  {guiText("条对话")}</span>}
    </div>
    <div className={styles.results} aria-label={guiText("对话列表")} aria-busy={loading}>
      {loading ? <div className={styles.empty} role="status">
        <Spin size="small" /><span>{guiText("正在查找对话…")}</span>
      </div> : <>
        {state.threads.map((thread) => <button key={thread.id} className={styles.result}
          type="button"
          disabled={state.sending || state.connection !== "ready"} onClick={() => {
            void controller.select(thread.id);
            onClose();
          }}>
          <span className={styles.threadIcon}><MessageSquare size={18} aria-hidden="true" /></span>
          <span className={styles.details}>
            <span className={styles.title}>{threadTitle(thread)}</span>
            <span className={styles.project}><Folder size={12} aria-hidden="true" />
              <span>{projectName(thread.cwd)}</span>
            </span>
          </span>
          <ArrowUpRight className={styles.openIcon} size={17} aria-hidden="true" />
        </button>)}
        {!state.threads.length && <div className={styles.empty} role="status">
          <Search size={28} strokeWidth={1.5} aria-hidden="true" />
          <span>{search.trim() ? guiText("没有找到匹配的对话") : guiText("还没有对话")}</span>
          {search.trim() && <span className={styles.emptyHint}>{guiText("换个关键词试试")}</span>}
        </div>}
      </>}
      {state.cursor && <Button type="text" block loading={loading} disabled={state.connection !== "ready"}
        onClick={() => void controller.refresh(true)}>{guiText("加载更多")}</Button>}
    </div>
    <div className={styles.footer}><span>{guiText("选择对话，继续聊天")}</span><span><kbd>Esc</kbd>  {guiText("关闭")}</span></div>
  </Modal>;
}
