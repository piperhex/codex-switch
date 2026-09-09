import { useMemo, useState, type ReactNode } from "react";
import { App, Button, Dropdown, Input, Modal, Segmented, Spin } from "antd";
import { Archive, MoreHorizontal, Pencil, Pin, RefreshCw, Search, SquarePen, Trash2 } from "lucide-react";
import type { GuiController } from "./controller";
import type { GuiState, Thread } from "./types";
import { ThreadGroup } from "./ThreadGroup";
import { ThreadSearch } from "./ThreadSearch";
import { useThreadGroupViews } from "./useThreadGroupViews";
import { projectName } from "./projectCatalog";
import styles from "./styles.module.less";

export function threadTitle(thread: Thread) { return thread.name || thread.preview || "新对话"; }
export { projectName } from "./projectCatalog";

export function ThreadSidebar({ state, controller, accountPicker }: {
  state: GuiState; controller: GuiController; accountPicker: ReactNode;
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [renaming, setRenaming] = useState<Thread | null>(null);
  const [deleting, setDeleting] = useState<Thread | null>(null);
  const { message } = App.useApp();
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
  }, [state.threads, state.pins, state.projects]);
  const renderThread = (thread: Thread) => {
    const running = Boolean(state.conversations[thread.id]?.activeTurn) || thread.status?.type === "active";
    const busy = state.sending || Boolean(state.deleting);
    const needsInput = state.approvals.some((event) => event.params.threadId === thread.id);
    const items = [
      { key: "pin", label: state.pins.includes(thread.id) ? "取消置顶" : "置顶", icon: <Pin size={14} /> },
      { key: "rename", label: "重命名", icon: <Pencil size={14} />, disabled: running },
      { key: "archive", label: state.archived ? "恢复对话" : "归档", icon: <Archive size={14} />, disabled: running },
      { key: "delete", label: "删除", icon: <Trash2 size={14} />, danger: true,
        disabled: running || busy || needsInput || Boolean(state.queued[thread.id]?.length)
          || state.connection !== "ready" },
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
        if (key === "delete") setDeleting(thread);
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
    <button type="button" className={styles.newButton} disabled={state.sending}
      onClick={controller.newConversation}>
      <SquarePen size={18} strokeWidth={1.6} aria-hidden="true" /><span>新对话</span>
    </button>
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
    <Modal title="删除这条对话？" open={Boolean(deleting)} width={400} okText="移入回收站" cancelText="取消"
      confirmLoading={Boolean(state.deleting)} okButtonProps={{ danger: true }}
      closable={!state.deleting} maskClosable={!state.deleting} keyboard={!state.deleting}
      cancelButtonProps={{ disabled: Boolean(state.deleting) }}
      onCancel={() => { if (!state.deleting) setDeleting(null); }}
      onOk={async () => {
        if (deleting && await controller.deleteThread(deleting.id)) {
          setDeleting(null);
          void message.success(<span className="compact-confirm-copy">
            已移入会话管理的回收站，可在那里恢复。
          </span>);
        }
      }}>
      <p className="compact-confirm-copy">删除后可在“会话管理”的回收站中找到，并恢复到指定的 Codex Home。</p>
    </Modal>
    <Modal title="重命名对话" open={Boolean(renaming)} width={400} okText="保存" cancelText="取消"
      okButtonProps={{ disabled: !name.trim() }} onCancel={() => setRenaming(null)}
      onOk={() => { if (renaming) void controller.manage("rename", renaming.id, name); setRenaming(null); }}>
      <Input value={name} maxLength={120} autoFocus aria-label="对话名称"
        onChange={(event) => setName(event.target.value)} />
    </Modal>
  </aside>;
}
