import type { ReactElement } from "react";
import { App, Dropdown, type MenuProps } from "antd";
import { MoreHorizontal, Pin, PinOff, X } from "lucide-react";
import type { GuiController } from "./controller";
import type { GuiState } from "./types";
import styles from "./ThreadGroup.module.less";

export function ProjectGroupMenu({ path, label, state, controller, children }: {
  path: string; label: string; state: GuiState; controller: GuiController; children: ReactElement;
}) {
  const { message } = App.useApp();
  const pinned = state.pinnedProjects.includes(path);
  const remove = async () => {
    if (await controller.projectActions.remove(path)) {
      void message.success(<span className="compact-confirm-copy">项目已移除，对话已归入“最近”。</span>);
    }
  };
  const menu: MenuProps = { items: [
    { key: "pin", label: pinned ? "取消置顶" : "置顶", icon: pinned ? <PinOff size={16} /> : <Pin size={16} /> },
    { type: "divider" },
    { key: "remove", label: state.removingProject === path ? "正在移除…" : "移除项目", icon: <X size={16} />,
      disabled: state.sending || Boolean(state.removingProject) || state.connection !== "ready" },
  ], onClick: ({ key }) => {
    if (key === "pin") controller.projectActions.pin(path);
    if (key === "remove") void remove();
  } };
  return <>
    <Dropdown trigger={["contextMenu"]} overlayStyle={{ maxWidth: 400 }} menu={menu}>
      {children}
    </Dropdown>
    <Dropdown trigger={["click"]} overlayStyle={{ maxWidth: 400 }} menu={menu}>
      <button type="button" className={styles.add} aria-label={`管理项目：${label}`}>
        <MoreHorizontal size={14} aria-hidden="true" />
      </button>
    </Dropdown>
  </>;
}
