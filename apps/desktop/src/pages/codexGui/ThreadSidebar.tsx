import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Button, Dropdown, Input, Modal, Segmented, Spin } from "antd";
import { Archive, Folder, MoreHorizontal, Pencil, Pin, Plus, RefreshCw, Search } from "lucide-react";
import type { GuiController } from "./controller";
import type { GuiState, Thread } from "./types";
import styles from "./styles.module.less";

export function threadTitle(thread: Thread) { return thread.name || thread.preview || "新对话"; }
export function projectName(path: string) { return path.split(/[\\/]/).filter(Boolean).pop() || "无项目"; }

export function ThreadSidebar({ state, controller, accountPicker }: {
  state: GuiState; controller: GuiController; accountPicker: ReactNode;
}) {
  const [search, setSearch] = useState(state.search);
  const [renaming, setRenaming] = useState<Thread | null>(null);
  const [name, setName] = useState("");
  useEffect(() => {
    if (search === state.search || state.connection !== "ready") return;
    const timer = setTimeout(() => controller.filter(search, state.archived), 300);
    return () => clearTimeout(timer);
  }, [search, state.search, state.archived, state.connection, controller]);
  const groups = useMemo(() => {
    const pinned = state.threads.filter((thread) => state.pins.includes(thread.id));
    const byProject = new Map<string, Thread[]>();
    state.threads.filter((thread) => !state.pins.includes(thread.id)).forEach((thread) => {
      const key = thread.cwd || "";
      byProject.set(key, [...(byProject.get(key) ?? []), thread]);
    });
    return [...(pinned.length ? [["置顶", pinned] as const] : []), ...byProject.entries()];
  }, [state.threads, state.pins]);
  const renderThread = (thread: Thread) => {
    const running = Boolean(state.conversations[thread.id]?.activeTurn);
    const needsInput = state.approvals.some((event) => event.params.threadId === thread.id);
    const items = [
      { key: "pin", label: state.pins.includes(thread.id) ? "取消置顶" : "置顶", icon: <Pin size={14} /> },
      { key: "rename", label: "重命名", icon: <Pencil size={14} />, disabled: running },
      { key: "archive", label: state.archived ? "恢复对话" : "归档", icon: <Archive size={14} />, disabled: running },
    ];
    return <div className={`${styles.thread} ${state.selected === thread.id ? styles.selected : ""}`} key={thread.id}>
      <button className={styles.threadSelect} disabled={state.sending}
        onClick={() => void controller.select(thread.id)}>
        <span className={needsInput ? styles.waitingDot : running ? styles.runningDot : styles.idleDot} />
        <span>{threadTitle(thread)}</span>
      </button>
      <Dropdown trigger={["click"]} menu={{ items, onClick: ({ key }) => {
        if (key === "pin") controller.pin(thread.id);
        if (key === "rename") { setRenaming(thread); setName(threadTitle(thread)); }
        if (key === "archive") void controller.manage(state.archived ? "unarchive" : "archive", thread.id);
      } }}>
        <button className={styles.threadMenu} aria-label={`管理对话：${threadTitle(thread)}`}>
          <MoreHorizontal size={16} /></button>
      </Dropdown>
    </div>;
  };
  return <aside className={styles.sidebar}>
    <div className={styles.sidebarHeading}><strong>对话</strong>
      <Button type="text" size="small" icon={<RefreshCw size={15} />} aria-label="刷新对话"
        loading={state.loading} disabled={state.connection !== "ready"} onClick={() => void controller.refresh()} />
    </div>
    <Button className={styles.newButton} icon={<Plus size={16} />} disabled={state.sending}
      onClick={controller.newConversation}>新对话</Button>
    <Input prefix={<Search size={14} />} placeholder="搜索对话" aria-label="搜索对话" value={search}
      allowClear onChange={(event) => setSearch(event.target.value)} />
    <Segmented block size="small" value={state.archived ? "archived" : "recent"}
      options={[{ label: "最近", value: "recent" }, { label: "已归档", value: "archived" }]}
      onChange={(value) => controller.filter(search, value === "archived")} disabled={state.connection !== "ready"} />
    <div className={styles.threadList}>
      {groups.map(([project, threads]) => <div className={styles.threadGroup} key={project}>
        <div className={styles.projectHeading}><Folder size={14} /><span>{projectName(project)}</span></div>
        {threads.map(renderThread)}
      </div>)}
      {!state.threads.length && <p className={styles.listEmpty}>{state.loading ? <Spin size="small" /> : "还没有对话"}</p>}
      {state.cursor && <Button type="text" block loading={state.loading}
        onClick={() => void controller.refresh(true)}>加载更多</Button>}
    </div>
    {accountPicker}
    <Modal title="重命名对话" open={Boolean(renaming)} width={400} okText="保存" cancelText="取消"
      okButtonProps={{ disabled: !name.trim() }} onCancel={() => setRenaming(null)}
      onOk={() => { if (renaming) void controller.manage("rename", renaming.id, name); setRenaming(null); }}>
      <Input value={name} maxLength={120} autoFocus aria-label="对话名称"
        onChange={(event) => setName(event.target.value)} />
    </Modal>
  </aside>;
}
