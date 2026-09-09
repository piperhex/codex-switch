import { useEffect, useRef, useState } from "react";
import { Input, Popover, type InputRef } from "antd";
import { Folder, Plus, Search, X } from "lucide-react";
import { isDesktopApp } from "../../api/backend";
import { CreateProjectDialog } from "./CreateProjectDialog";
import { folderName, readProjects, saveProject, type SavedProject } from "./projectCatalog";
import layout from "./styles.module.less";
import styles from "./ProjectPicker.module.less";
import { WorkspacePicker } from "./WorkspacePicker";

interface ProjectPickerProps {
  value: string;
  projects: string[];
  disabled: boolean;
  onChange: (cwd: string) => void;
  onError: (error: unknown) => void;
  gitEnabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
}

export function ProjectPicker({ value, projects, disabled, onChange, onError,
  gitEnabled, onBusyChange }: ProjectPickerProps) {
  const [expanded, setExpanded] = useState(false);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");
  const [saved, setSaved] = useState(readProjects);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<InputRef>(null);
  const list = useRef<HTMLDivElement>(null);
  const label = (path: string) => saved.find((project) => project.path === path)?.name ?? folderName(path);
  const paths = [...new Set([value, ...saved.map((project) => project.path), ...projects])].filter(Boolean);
  const matches = paths.filter((path) => `${label(path)} ${path}`.toLocaleLowerCase()
    .includes(query.trim().toLocaleLowerCase()));
  useEffect(() => { if (disabled) { setExpanded(false); setCreating(false); } }, [disabled]);
  const close = () => { setExpanded(false); trigger.current?.focus(); };
  const create = (project: SavedProject) => {
    if (disabled) return;
    try {
      setSaved(saveProject(project));
      onChange(project.path);
      setCreating(false);
      trigger.current?.focus();
    } catch { onError(new Error("项目未能保存，请重试。")); }
  };
  const panel = <div className={styles.panel} onKeyDown={(event) => {
    if (event.key === "Escape") { event.stopPropagation(); close(); }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const options = Array.from(list.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
    const current = options.indexOf(document.activeElement as HTMLButtonElement);
    const next = current + (event.key === "ArrowDown" ? 1 : -1);
    event.preventDefault();
    if (next < 0 || next >= options.length) search.current?.focus();
    else options[next]?.focus();
  }}>
    <Input ref={search} variant="borderless" className={styles.search} prefix={<Search size={16} />}
      aria-label="搜索项目" placeholder="搜索项目" value={query} onChange={(event) => setQuery(event.target.value)} />
    <div ref={list} className={styles.list} role="menu" aria-label="项目">
      {matches.map((path) => <button key={path} type="button" role="menuitemradio"
        aria-checked={value === path} className={styles.option} disabled={disabled}
        onClick={() => { if (!disabled) { onChange(path); close(); } }}>
        <Folder size={18} aria-hidden="true" /><span>{label(path)}</span>
      </button>)}
      {!matches.length && <p className={styles.empty}>{query.trim() ? "没有找到匹配的项目" : "还没有项目"}</p>}
    </div>
    <div className={styles.divider} />
    <button type="button" className={`${styles.option} ${styles.newProject}`} disabled={disabled}
      onClick={() => { setExpanded(false); setCreating(true); }}>
      <Plus size={20} aria-hidden="true" /><span>新建项目</span>
    </button>
  </div>;
  return <div className={layout.projectBar}>
    <span className={styles.selection}>
      {value && <button type="button" className={styles.remove} disabled={disabled}
        aria-label="移除项目选择" onClick={() => onChange("")}>
        <Folder className={styles.folder} size={16} aria-hidden="true" />
        <X className={styles.cross} size={16} aria-hidden="true" />
      </button>}
      <Popover trigger="click" placement="topLeft" arrow={false} open={expanded && !disabled} content={panel}
        onOpenChange={(open) => { setExpanded(open); if (open) { setQuery(""); setSaved(readProjects()); } }}
        afterOpenChange={(open) => { if (open) search.current?.focus(); }}
        styles={{ root: { maxWidth: 400 }, body: { padding: 0, borderRadius: 20, overflow: "hidden" } }}>
        <button ref={trigger} type="button" className={styles.name} disabled={disabled}
          aria-haspopup="menu" aria-expanded={expanded && !disabled}
          aria-label={value ? `选择项目文件夹：${label(value)}` : "选择项目文件夹"}>
          {!value && <Folder size={16} aria-hidden="true" />}<span>{value ? label(value) : "选择项目"}</span>
        </button>
      </Popover>
    </span>
    {gitEnabled && onBusyChange ? <WorkspacePicker key={value} cwd={value} disabled={disabled}
      onChange={onChange} onBusyChange={onBusyChange} />
      : <span className={layout.localLabel}>{isDesktopApp ? "本地" : "Codex Switch 主机"}</span>}
    {creating && <CreateProjectDialog disabled={disabled} onCreate={create} onError={onError}
      onClose={() => { setCreating(false); trigger.current?.focus(); }} />}
  </div>;
}
