import type { ReactNode } from "react";
import { Dropdown, type MenuProps } from "antd";
import { ChevronRight, Code2, Copy, File, FileDiff, FolderOpen, Save, Terminal } from "lucide-react";
import type { FileReference } from "./fileReference";
import { useFileMenu } from "./useFileMenu";
import styles from "./FileMenu.module.less";

// Submenus may overlap the parent when two columns cannot fit in a narrow window.
const SUBMENU_PLACEMENTS: MenuProps["builtinPlacements"] = {
  rightTop: { points: ["tl", "tr"], overflow: { adjustX: true, adjustY: true, shiftX: true, shiftY: true } },
  leftTop: { points: ["tr", "tl"], overflow: { adjustX: true, adjustY: true, shiftX: true, shiftY: true } },
};

export function FileMenu({ path, line, column, children, className, onReview }: FileReference & {
  children: ReactNode; className?: string; onReview?: () => void;
}) {
  const target = { path, ...(line && { line }), ...(column && { column }) };
  const menu = useFileMenu(target);
  const openApplication = (application: string) => { void menu.perform({ type: "open", application }); };
  const applications: MenuProps["items"] = menu.applications.map((app) => ({
    key: app.id, label: app.name,
    icon: app.kind === "terminal" ? <Terminal size={16} /> : <Code2 size={16} />,
    onClick: () => openApplication(app.id),
  }));
  const items: MenuProps["items"] = [
    { key: "open", label: "打开文件", icon: <File size={16} />, disabled: !menu.desktop,
      onClick: () => openApplication("default") },
    ...(menu.applications.some((app) => app.id === "vscode") ? [{ key: "vscode", label: "在 VS Code 中打开",
      icon: <Code2 size={16} />, onClick: () => openApplication("vscode") }] : []),
    { key: "openWith", label: "打开方式", icon: <FolderOpen size={16} />, disabled: !menu.desktop,
      popupClassName: styles.popup, children: [
        { key: "default", label: "默认应用", icon: <File size={16} />, onClick: () => openApplication("default") },
        ...applications,
        ...(menu.loading ? [{ key: "loading", label: "正在查找应用…", disabled: true }] : []),
        ...(menu.failed ? [{ key: "failed", label: "未能读取应用，请重新打开菜单", disabled: true }] : []),
      ] },
    { type: "divider" },
    ...(onReview ? [{ key: "review", label: "查看差异", icon: <FileDiff size={16} />, onClick: onReview }] : []),
    { key: "saveAs", label: "另存为…", icon: <Save size={16} />, disabled: !menu.desktop,
      onClick: () => { void menu.perform({ type: "saveAs" }); } },
    { key: "copyPath", label: "复制路径", icon: <Copy size={16} />,
      onClick: () => { void menu.perform({ type: "copyPath" }); } },
    { key: "copyContents", label: "复制文件内容", icon: <Copy size={16} />, disabled: !menu.desktop,
      onClick: () => { void menu.perform({ type: "copyContents" }); } },
    { key: "reveal", label: "在文件管理器中显示", icon: <FolderOpen size={16} />, disabled: !menu.desktop,
      onClick: () => { void menu.perform({ type: "reveal" }); } },
  ];
  // The browser retains its existing diff shortcut; local file operations belong to the desktop.
  if (!menu.desktop && onReview) return <button type="button" className={className}
    onClick={onReview} aria-label={`查看 ${path} 的差异`}>{children}</button>;
  return <Dropdown trigger={["click", "contextMenu"]} open={menu.open} onOpenChange={menu.setOpen} autoFocus
    overlayClassName={styles.popup} overlayStyle={{ maxWidth: 400 }}
    menu={{ items, builtinPlacements: SUBMENU_PLACEMENTS, expandIcon: <ChevronRight size={14} aria-hidden="true" />,
      onClick: () => menu.setOpen(false) }} disabled={menu.busy}>
    <button type="button" className={className ?? styles.link} aria-label={`文件操作：${path}`}
      aria-haspopup="menu" aria-expanded={menu.open} disabled={menu.busy}>{children}</button>
  </Dropdown>;
}
