import { Button, Select } from "antd";
import { FolderOpen, X } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { projectName } from "./ThreadSidebar";
import layout from "./styles.module.less";
import styles from "./ProjectPicker.module.less";

interface ProjectPickerProps {
  value: string;
  projects: string[];
  disabled: boolean;
  onChange: (cwd: string) => void;
  onError: (error: unknown) => void;
}

export function ProjectPicker({ value, projects, disabled, onChange, onError }: ProjectPickerProps) {
  const chooseFolder = async () => {
    try {
      const path = await open({ directory: true, multiple: false, title: "选择项目文件夹" });
      if (typeof path === "string") onChange(path);
    } catch (error) { onError(error); }
  };
  return <div className={layout.projectBar}>
    {value ? <span className={styles.selection}>
      <button type="button" className={styles.remove} disabled={disabled}
        aria-label="移除项目选择" onClick={() => onChange("")}>
        <FolderOpen className={styles.folder} size={16} aria-hidden="true" />
        <X className={styles.cross} size={16} aria-hidden="true" />
      </button>
      <button type="button" className={styles.name} disabled={disabled}
        aria-label={`选择项目文件夹：${projectName(value)}`} onClick={() => void chooseFolder()}>
        {projectName(value)}
      </button>
    </span> : <Button type="text" size="small" icon={<FolderOpen size={16} />} disabled={disabled}
      aria-label="选择项目文件夹" onClick={() => void chooseFolder()}>选择项目（可选）</Button>}
    {projects.length > 0 && <Select size="small" variant="borderless" aria-label="最近项目" disabled={disabled}
      placeholder="最近项目" value={undefined}
      options={projects.map((path) => ({ value: path, label: projectName(path) }))} onChange={onChange} />}
    <span className={layout.localLabel}>本地</span>
  </div>;
}
