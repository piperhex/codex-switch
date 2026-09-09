import { useMemo, useState, type ReactNode } from "react";
import { Button, Dropdown, Input, Modal, Segmented, Spin } from "antd";
import { Archive, MoreHorizontal, Pencil, Pin, Plus, RefreshCw, Search } from "lucide-react";
import type { GuiController } from "./controller";
import type { GuiState, Thread } from "./types";
import { ThreadGroup } from "./ThreadGroup";
import { ThreadSearch } from "./ThreadSearch";
import { useThreadGroupViews } from "./useThreadGroupViews";
import styles from "./styles.module.less";

export function threadTitle(thread: Thread) { return thread.name || thread.preview || "新对话"; }
export function projectName(path: string) { return path.split(/[\\/]/).filter(Boolean).pop() || "无项目"; }

export function ThreadSidebar({ state, controller, accountPicker }: {
  state: GuiState; controller: GuiController; accountPicker: ReactNode;
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [renaming, setRenaming] = useState<Thread | null>(null);
  const [name, setName] = useState("");
  const { views, toggle } = useThreadGroupViews();
  const closeSearch = () => {
    setSearchOpen(false);
    if (state.search) controller.filter("", state.archived);
  };
  const groups = useMemo(() => {
    const pinned = state.threads.filter((thread) => state.pins.includes(thread.id));
    const byProject = new Map<string, Thread[]>();
    state.threads.filter((thread) => !state.pins.includes(thread.id)).forEach((thread) => {
      const key = thread.cwd || "";
      byProject.set(key, [...(byProject.get(key) ?? []), thread]);
    });
    return [
      ...(pinned.length ? [{ id: "pinned", label: "置顶", pinned: true, threads: pinned }] : []),
      ...Array.from(byProject, ([path, threads]) => ({
        id: `project:${path}`, label: projectName(path), pinned: false, threads,
      })),
    ];
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
      <div className={styles.sidebarActions}>
        <Button type="text" size="small" icon={<RefreshCw size={15} />} aria-label="刷新对话"
          loading={state.loading} disabled={state.connection !== "ready"} onClick={() => void controller.refresh()} />
        <Button type="text" size="small" icon={<Search size={15} />} aria-label="搜索对话"
          disabled={state.connection !== "ready"} onClick={() => setSearchOpen(true)} />
      </div>
    </div>
    <Button className={styles.newButton} icon={<Plus size={16} />} disabled={state.sending}
      onClick={controller.newConversation}>新对话</Button>
    <Segmented block size="small" value={state.archived ? "archived" : "recent"}
      options={[{ label: "最近", value: "recent" }, { label: "已归档", value: "archived" }]}
      onChange={(value) => controller.filter("", value === "archived")} disabled={state.connection !== "ready"} />
    <div className={styles.threadList}>
      {groups.map((group) => {
        const key = `${state.archived ? "archived" : "recent"}:${group.id}`;
        return <ThreadGroup key={key} label={group.label} pinned={group.pinned} threads={group.threads}
          selected={state.selected} collapsed={views.collapsed.includes(key)} expanded={views.expanded.includes(key)}
          filtering={Boolean(state.search.trim())} onToggle={(field) => toggle(field, key)}
          renderThread={renderThread} />;
      })}
      {!state.threads.length && <p className={styles.listEmpty}>{state.loading ? <Spin size="small" /> : "还没有对话"}</p>}
      {state.cursor && <Button type="text" block loading={state.loading}
        onClick={() => void controller.refresh(true)}>加载更多</Button>}
    </div>
    {accountPicker}
    {searchOpen && <ThreadSearch state={state} controller={controller} onClose={closeSearch} />}
    <Modal title="重命名对话" open={Boolean(renaming)} width={400} okText="保存" cancelText="取消"
      okButtonProps={{ disabled: !name.trim() }} onCancel={() => setRenaming(null)}
      onOk={() => { if (renaming) void controller.manage("rename", renaming.id, name); setRenaming(null); }}>
      <Input value={name} maxLength={120} autoFocus aria-label="对话名称"
        onChange={(event) => setName(event.target.value)} />
    </Modal>
  </aside>;
}
