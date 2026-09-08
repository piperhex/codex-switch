import { useEffect, useRef } from "react";
import { Box } from "lucide-react";
import type { Skill } from "./types";
import { skillDescription, skillLabel } from "./skillEditorDom";
import styles from "./SkillInput.module.less";

export function SkillMenu({ id, skills, selected, loading, error, onChoose }: {
  id: string; skills: Skill[]; selected: number; loading: boolean; error: string; onChoose: (skill: Skill) => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: "nearest" });
  }, [selected]);
  return <div className={styles.menu} onMouseDown={(event) => event.preventDefault()}>
    <div className={styles.menuHeading}>选择 Skill</div>
    <div ref={list} id={id} role="listbox" aria-label="Skills" className={styles.options}>
      {skills.map((skill, index) => <button type="button" role="option" id={`${id}-${index}`}
        key={skill.path} tabIndex={-1} aria-selected={selected === index} aria-disabled={!skill.enabled}
        onClick={() => skill.enabled && onChoose(skill)}>
        <Box size={18} /><span><strong>{skillLabel(skill)}{!skill.enabled && "（已停用）"}</strong>
          <small>{skillDescription(skill)}</small></span>
      </button>)}
    </div>
    {loading && <p role="status">正在加载 Skill…</p>}
    {error && <p role="status">{error}</p>}
    {!loading && !error && !skills.length && <p role="status">没有找到匹配的 Skill</p>}
  </div>;
}
